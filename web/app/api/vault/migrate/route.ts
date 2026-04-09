import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'
import type { TypedRelation } from '@/lib/types'

export function migrateNote(raw: string): { updated: string; changed: boolean } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const blockRe = /<!-- superbrain:related -->\n([\s\S]*?)\n<!-- \/superbrain:related -->/
  const match = normalized.match(blockRe)
  if (!match) return { updated: raw, changed: false }

  const stems = [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
  const { data, content } = matter(normalized)
  const relations: TypedRelation[] = Array.isArray(data.relations) ? data.relations : []

  for (const stem of stems) {
    const alreadyPresent = relations.some(
      (r: TypedRelation) =>
        typeof r.target === 'string' &&
        r.target.replace(/^\[\[|\]\]$/g, '').toLowerCase() === stem.toLowerCase()
    )
    if (!alreadyPresent) {
      relations.push({ target: `[[${stem}]]` })
    }
  }
  if (relations.length > 0) data.relations = relations

  const cleanContent = content.replace(
    /\n{0,2}<!-- superbrain:related -->\n[\s\S]*?\n<!-- \/superbrain:related -->/,
    ''
  )
  return { updated: matter.stringify(cleanContent, data), changed: true }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = getVaultClient()
  const tree = await client.getMarkdownTree()

  let migrated = 0
  const errors: string[] = []

  for (const { path } of tree) {
    try {
      const { content: raw, sha } = await client.readFile(path)
      const { updated, changed } = migrateNote(raw)
      if (changed) {
        const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
        await client.writeFile(
          path,
          updated,
          sha,
          `brain: migrate [[${stem}]] managed block to relations`
        )
        migrated++
      }
    } catch {
      errors.push(path)
    }
  }

  invalidateCache()
  return NextResponse.json({ migrated, errors })
}
