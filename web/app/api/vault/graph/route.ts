import { NextResponse } from 'next/server'
import { getVaultClient } from '@/lib/github'
import { buildGraph } from '@/lib/vault-parser'
import { getCachedGraph, setCachedGraph } from '@/lib/graph-cache'

export async function GET() {
  // TODO: add auth check in Task 7
  // const session = await getServerSession(authOptions)
  // if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cached = getCachedGraph()
  if (cached) return NextResponse.json(cached)

  const client = getVaultClient()
  const tree = await client.getMarkdownTree()

  const files = await Promise.all(
    tree.map(async file => {
      const { content } = await client.readFile(file.path)
      return [file.path, content] as [string, string]
    })
  )

  const graph = buildGraph(files)
  setCachedGraph(graph)

  return NextResponse.json(graph)
}
