import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'
import { addToManagedBlock, removeFromManagedBlock } from '@/lib/vault-parser'

export function applySetType(raw: string, type: string): string {
  const { data, content } = matter(raw)
  data.type = type
  return matter.stringify(content, data)
}

export function applyAddRelation(raw: string, target: string, relationType: string | null): string {
  const { data, content } = matter(raw)
  if (relationType) {
    const relations: any[] = Array.isArray(data.relations) ? data.relations : []
    const alreadyPresent = relations.some(
      (r: any) => typeof r.target === 'string' && r.target.replace(/^\[\[|\]\]$/g, '') === target
    )
    if (!alreadyPresent) {
      relations.push({ target: `[[${target}]]`, type: relationType })
      data.relations = relations
    }
  }
  const updatedContent = addToManagedBlock(content, target)
  return matter.stringify(updatedContent, data)
}

export function applyRemoveRelation(raw: string, target: string): string {
  const { data, content } = matter(raw)
  if (Array.isArray(data.relations)) {
    data.relations = (data.relations as any[]).filter(
      (r: any) => !(typeof r.target === 'string' && r.target.replace(/^\[\[|\]\]$/g, '') === target)
    )
    if (data.relations.length === 0) delete data.relations
  }
  const updatedContent = removeFromManagedBlock(content, target)
  return matter.stringify(updatedContent, data)
}

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
  const body = await req.json()

  const client = getVaultClient()
  const { content: raw, sha } = await client.readFile(filePath)
  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath

  let updated: string
  let message: string

  if (body.operation === 'set-type') {
    if (typeof body.type !== 'string' || !body.type.trim()) {
      return NextResponse.json({ error: 'type required' }, { status: 400 })
    }
    updated = applySetType(raw, body.type)
    message = `brain: set type of [[${stem}]] to ${body.type}`
  } else if (body.operation === 'add-relation') {
    if (typeof body.target !== 'string' || !body.target.trim()) {
      return NextResponse.json({ error: 'target required' }, { status: 400 })
    }
    updated = applyAddRelation(raw, body.target, body.relationType ?? null)
    message = `brain: link [[${stem}]] → [[${body.target}]]`
  } else if (body.operation === 'remove-relation') {
    if (typeof body.target !== 'string' || !body.target.trim()) {
      return NextResponse.json({ error: 'target required' }, { status: 400 })
    }
    updated = applyRemoveRelation(raw, body.target)
    message = `brain: unlink [[${stem}]] → [[${body.target}]]`
  } else if (typeof body.title === 'string') {
    const { data, content } = matter(raw)
    data.title = body.title
    updated = matter.stringify(content, data)
    message = `brain: rename [[${stem}]] to ${body.title}`
  } else {
    return NextResponse.json({ error: 'Unknown operation' }, { status: 400 })
  }

  await client.writeFile(filePath, updated, sha, message)
  invalidateCache()
  return NextResponse.json({ ok: true })
}
