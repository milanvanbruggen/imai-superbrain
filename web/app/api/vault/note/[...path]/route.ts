import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const { sha } = await req.json()

  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath
  const client = getVaultClient()
  try {
    await client.deleteFile(filePath, sha, `brain: delete [[${stem}]]`)
  } catch {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
  invalidateCache()

  return NextResponse.json({ ok: true })
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const { title } = await req.json()

  const client = getVaultClient()
  const { content: raw, sha } = await client.readFile(filePath)
  const { data, content } = matter(raw)
  data.title = title
  const updated = matter.stringify(content, data)

  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath
  await client.writeFile(filePath, updated, sha, `brain: rename [[${stem}]] to ${title}`)
  invalidateCache()

  return NextResponse.json({ ok: true })
}
