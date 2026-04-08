import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { computeVaultHash } from '@/lib/graph-cache'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = getVaultClient()
    const tree = await client.getMarkdownTree()
    return NextResponse.json({ hash: computeVaultHash(tree) })
  } catch {
    return NextResponse.json({ hash: null })
  }
}
