import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { getStemFromPath } from '@/lib/note-utils'
import { invalidateCache } from '@/lib/graph-cache'

const NL_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatNlDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return dateStr
  return `${day} ${NL_MONTHS[month - 1]} ${year}`
}

// Strip common "update header" lines like "Update voor [[onder]]:" before formatting
function cleanUpdateContent(content: string): string {
  return content
    .replace(/^(?:update|wijziging|change|verzoek)[^\n]*:\s*/im, '')
    .replace(/^\s*\n/, '')
    .trim()
}

function formatAsBullet(content: string, dateStr: string | undefined): string {
  const cleaned = cleanUpdateContent(content)
  if (!cleaned) return ''
  const prefix = dateStr ? `- **${formatNlDate(dateStr)}** — ` : '- '
  // If content is multi-paragraph, keep first paragraph on the bullet line and indent the rest
  const [firstPara, ...rest] = cleaned.split(/\n\n+/)
  const bullet = prefix + firstPara.replace(/\n/g, ' ')
  return rest.length > 0
    ? bullet + '\n\n  ' + rest.join('\n\n  ')
    : bullet
}

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

  // Format source content as a dated bullet and append to target
  const srcTrimmed = srcContent.trim()
  const tgtTrimmed = tgtContent.trim()
  const srcDate: string | undefined =
    typeof srcData.modified === 'string' ? srcData.modified
    : srcData.modified instanceof Date ? srcData.modified.toISOString().slice(0, 10)
    : typeof srcData.date === 'string' ? srcData.date
    : srcData.date instanceof Date ? srcData.date.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const formattedSrc = srcTrimmed ? formatAsBullet(srcTrimmed, srcDate) : ''
  const mergedContent = formattedSrc
    ? tgtTrimmed ? tgtTrimmed + '\n\n' + formattedSrc : formattedSrc
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
