import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const { content, sha } = await req.json()

  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath
  const isNew = !sha
  const message = isNew ? `brain: create [[${stem}]]` : `brain: update [[${stem}]]`

  const client = getVaultClient()
  try {
    await client.writeFile(filePath, content, sha ?? null, message)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }
  invalidateCache()

  return NextResponse.json({ ok: true })
}
