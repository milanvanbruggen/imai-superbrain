import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

// Exported for testing
export function spliceEmailIntoFrontmatter(raw: string, email: string): string {
  const lines = raw.split('\n')

  // No frontmatter — prepend one
  if (lines[0] !== '---') {
    return `---\nemail: ${email}\n---\n\n${raw}`
  }

  // Find closing ---
  let closingIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIdx = i
      break
    }
  }

  // Malformed (no closing ---) — append email line before a new closing marker
  if (closingIdx === -1) {
    return `${raw.trimEnd()}\nemail: ${email}\n---\n`
  }

  // Replace or add email line inside the frontmatter block
  const fmLines = lines.slice(1, closingIdx)
  const emailIdx = fmLines.findIndex(l => /^email:/.test(l))
  if (emailIdx >= 0) {
    fmLines[emailIdx] = `email: ${email}`
  } else {
    fmLines.push(`email: ${email}`)
  }

  // Rejoin: opening ---, frontmatter lines, then everything from the closing --- onward
  return ['---', ...fmLines, ...lines.slice(closingIdx)].join('\n')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, email } = await req.json()

  if (!path || !email) {
    return NextResponse.json({ error: 'path and email are required' }, { status: 400 })
  }
  if (!path.endsWith('.md') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
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

  const updated = spliceEmailIntoFrontmatter(content, email)

  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
  try {
    await client.writeFile(path, updated, sha, `brain: add email to [[${stem}]]`)
  } catch (err: any) {
    if (err.message?.includes('409') || err.status === 409) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
