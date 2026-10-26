import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { getStemFromPath } from '@/lib/note-utils'
import { computeVaultHash, getCachedGraph, invalidateCache } from '@/lib/graph-cache'
import { mapWithConcurrency } from '@/lib/concurrency'
import { linksTo, retargetLinks } from '@/lib/merge-links'
import { mergedBody } from '@/lib/merge-format'

const RELINK_CONCURRENCY = 5

// Merge sourcePath into targetPath (an inbox note into an existing note, or two notes in the vault).
// An inbox note is appended as a dated update, any other note as a section under its own title
// (its title is kept as an alias). Tags and relations are unioned.
// The source file is deleted after a successful merge. If deletion fails, inbox:true
// is removed from source as a fallback so it no longer appears in the inbox.
// Links to the source in other notes are pointed at the target, so they don't break.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourcePath, targetPath } = await req.json()
  if (typeof sourcePath !== 'string' || typeof targetPath !== 'string') {
    return NextResponse.json({ error: 'sourcePath and targetPath required' }, { status: 400 })
  }

  if (sourcePath === targetPath) {
    return NextResponse.json({ error: 'cannot merge a note into itself' }, { status: 400 })
  }

  const client = getVaultClient()

  // Find the notes that link to the source before anything changes; the cached graph saves reading every file
  const tree = await client.getMarkdownTree()
  const cached = getCachedGraph(computeVaultHash(tree))
  const linking = cached
    ? new Set(cached.edges.filter(e => e.target === sourcePath).map(e => e.source))
    : null
  const toRelink = tree
    .map(f => f.path)
    .filter(p => p !== sourcePath && p !== targetPath && (!linking || linking.has(p)))

  const [{ content: rawSource, sha: shaSource }, { content: rawTarget, sha: shaTarget }] =
    await Promise.all([client.readFile(sourcePath), client.readFile(targetPath)])

  const { data: srcData, content: srcContent } = matter(rawSource)
  const { data: tgtData, content: tgtContent } = matter(rawTarget)

  // Merge tags — union, preserve order (target first)
  const srcTags: string[] = Array.isArray(srcData.tags) ? srcData.tags : []
  const tgtTags: string[] = Array.isArray(tgtData.tags) ? tgtData.tags : []
  const mergedTags = [...new Set([...tgtTags, ...srcTags])]

  // Merge relations — target wins, add new ones from source
  type Relation = { target: string; type?: string }
  const tgtRelations: Relation[] = Array.isArray(tgtData.relations) ? tgtData.relations : []
  const srcRelations: Relation[] = Array.isArray(srcData.relations) ? srcData.relations : []
  const tgtRelTargets = new Set(
    tgtRelations.map(r => r.target.replace(/^\[\[|\]\]$/g, '').toLowerCase())
  )
  const newRelations = srcRelations.filter(
    r => !tgtRelTargets.has(r.target.replace(/^\[\[|\]\]$/g, '').toLowerCase())
  )
  // A relation between the two notes would point at the merged note itself
  const mergedRelations = [...tgtRelations, ...newRelations].filter(r => {
    const link = r.target.replace(/^\[\[|\]\]$/g, '')
    return !linksTo(link, sourcePath) && !linksTo(link, targetPath)
  })

  // Merge frontmatter: target wins; add any new keys from source (skip inbox meta fields)
  const skipKeys = new Set(['inbox', 'date', 'modified', 'title', 'type', 'tags', 'relations', 'aliases'])
  const mergedData = { ...tgtData }
  delete mergedData.inbox  // ensure merged note is never an inbox item
  for (const [key, value] of Object.entries(srcData)) {
    if (!skipKeys.has(key) && !(key in mergedData)) {
      mergedData[key] = value
    }
  }
  if (mergedTags.length > 0) mergedData.tags = mergedTags
  if (mergedRelations.length > 0) mergedData.relations = mergedRelations
  else delete mergedData.relations

  // A whole note keeps its name as an alias, so you (and Obsidian) still find it by that name
  const isUpdate = srcData.inbox === true
  const srcTitle = typeof srcData.title === 'string' && srcData.title.trim() ? srcData.title.trim() : getStemFromPath(sourcePath)
  const tgtTitle = typeof tgtData.title === 'string' && tgtData.title.trim() ? tgtData.title.trim() : getStemFromPath(targetPath)
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : typeof v === 'string' ? [v] : [])
  if (!isUpdate) {
    const aliases = [...new Set([
      ...asList(tgtData.aliases),
      ...(srcTitle.toLowerCase() !== tgtTitle.toLowerCase() ? [srcTitle] : []),
      ...asList(srcData.aliases),
    ])].filter(a => a.toLowerCase() !== tgtTitle.toLowerCase())
    if (aliases.length > 0) mergedData.aliases = aliases
  }

  const srcDate: string | undefined =
    typeof srcData.modified === 'string' ? srcData.modified
    : srcData.modified instanceof Date ? srcData.modified.toISOString().slice(0, 10)
    : typeof srcData.date === 'string' ? srcData.date
    : srcData.date instanceof Date ? srcData.date.toISOString().slice(0, 10)
    : undefined
  const mergedContent = mergedBody({ title: srcTitle, content: srcContent, inbox: isUpdate, date: srcDate }, tgtContent)

  const sourceStem = getStemFromPath(sourcePath)
  const targetStem = getStemFromPath(targetPath)
  const merged = matter.stringify('\n' + retargetLinks(mergedContent, sourcePath, targetStem) + '\n', mergedData)

  // Write merged content to target first
  await client.writeFile(targetPath, merged, shaTarget, `brain: merge [[${sourceStem}]] into [[${targetStem}]]`)

  // Delete source — if this fails, fall back to removing inbox:true so it doesn't
  // appear in the inbox or graph as a duplicate
  try {
    await client.deleteFile(sourcePath, shaSource, `brain: remove [[${sourceStem}]] after merge`)
  } catch {
    const { data: freshSrc, content: freshContent } = matter(rawSource)
    delete freshSrc.inbox
    const cleaned = matter.stringify(freshContent, freshSrc)
    const { sha: freshSha } = await client.readFile(sourcePath)
    await client.writeFile(sourcePath, cleaned, freshSha, `brain: clear inbox flag on [[${sourceStem}]] after merge`)
  }

  // Point links to the source at the target
  let relinked = 0
  let relinkFailed = 0
  await mapWithConcurrency(toRelink, RELINK_CONCURRENCY, async path => {
    try {
      const { content, sha } = await client.readFile(path)
      const next = retargetLinks(content, sourcePath, targetStem)
      if (next === content) return
      await client.writeFile(path, next, sha, `brain: point links to [[${sourceStem}]] at [[${targetStem}]]`)
      relinked++
    } catch {
      relinkFailed++
    }
  })

  invalidateCache()
  return NextResponse.json({ ok: true, relinked, relinkFailed })
}
