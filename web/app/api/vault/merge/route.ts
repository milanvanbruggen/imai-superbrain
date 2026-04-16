import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { getStemFromPath } from '@/lib/note-utils'
import { invalidateCache } from '@/lib/graph-cache'

// Merge sourcePath (inbox note) into targetPath (existing note).
// Newer content from source is appended to target; tags and relations are unioned.
// The source file is deleted after a successful merge. If deletion fails, inbox:true
// is removed from source as a fallback so it no longer appears in the inbox.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourcePath, targetPath } = await req.json()
  if (typeof sourcePath !== 'string' || typeof targetPath !== 'string') {
    return NextResponse.json({ error: 'sourcePath and targetPath required' }, { status: 400 })
  }

  const client = getVaultClient()

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
  const mergedRelations = [...tgtRelations, ...newRelations]

  // Merge frontmatter: target wins; add any new keys from source (skip inbox meta fields)
  const skipKeys = new Set(['inbox', 'date', 'modified', 'title', 'type', 'tags', 'relations'])
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

  // Append source body content to target (only if source has meaningful content)
  const srcTrimmed = srcContent.trim()
  const tgtTrimmed = tgtContent.trim()
  const mergedContent = srcTrimmed
    ? tgtTrimmed ? tgtTrimmed + '\n\n' + srcTrimmed : srcTrimmed
    : tgtTrimmed

  const merged = matter.stringify('\n' + mergedContent + '\n', mergedData)
  const sourceStem = getStemFromPath(sourcePath)
  const targetStem = getStemFromPath(targetPath)

  // Write merged content to target first
  await client.writeFile(targetPath, merged, shaTarget, `brain: merge [[${sourceStem}]] into [[${targetStem}]]`)

  // Delete source — if this fails, fall back to removing inbox:true so it doesn't
  // appear in the inbox or graph as a duplicate
  try {
    await client.deleteFile(sourcePath, shaSource, `brain: remove inbox note [[${sourceStem}]] after merge`)
  } catch {
    const { data: freshSrc, content: freshContent } = matter(rawSource)
    delete freshSrc.inbox
    const cleaned = matter.stringify(freshContent, freshSrc)
    const { sha: freshSha } = await client.readFile(sourcePath)
    await client.writeFile(sourcePath, cleaned, freshSha, `brain: clear inbox flag on [[${sourceStem}]] after merge`)
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
