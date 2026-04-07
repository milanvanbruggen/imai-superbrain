import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, summary } = await req.json()
  if (!path || !summary) {
    return NextResponse.json({ error: 'path and summary are required' }, { status: 400 })
  }

  if (!path.endsWith('.md') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const client = getVaultClient()

  let content: string
  let sha: string
  try {
    const result = await client.readFile(path)
    content = result.content
    sha = result.sha
  } catch {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  }

  const appendedContent = content.trimEnd() + '\n\n## Email context\n\n' + summary.trim() + '\n'

  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
  try {
    await client.writeFile(path, appendedContent, sha, `brain: update [[${stem}]] with email context`)
  } catch (err: any) {
    // GitHub returns 409 on SHA conflict
    if (err.message?.includes('409') || err.status === 409) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
