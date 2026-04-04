import { NextRequest, NextResponse } from 'next/server'
import { getVaultClient } from '@/lib/github'
import { invalidateCache } from '@/lib/graph-cache'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // TODO: add auth check in Task 7
  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const client = getVaultClient()
  try {
    const { content, sha } = await client.readFile(filePath)
    return NextResponse.json({ content, sha, path: filePath })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // TODO: add auth check in Task 7
  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const { content, sha } = await req.json()

  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath
  const isNew = !sha
  const message = isNew ? `brain: create [[${stem}]]` : `brain: update [[${stem}]]`

  const client = getVaultClient()
  await client.writeFile(filePath, content, sha ?? null, message)
  invalidateCache()

  return NextResponse.json({ ok: true })
}
