import { NextResponse } from 'next/server'
import { getVaultClient } from '@/lib/vault-client'
import { buildGraph } from '@/lib/vault-parser'
import { getCachedGraph, setCachedGraph, computeVaultHash } from '@/lib/graph-cache'
import { withAuth } from '@/lib/api-utils'

let buildInFlight: Promise<void> | null = null

export async function GET() {
  return withAuth(async () => {
    let client
    try {
      client = getVaultClient()
    } catch {
      return NextResponse.json({ error: 'vault_not_configured' }, { status: 422 })
    }

    let tree: { path: string; sha: string }[]
    try {
      tree = await client.getMarkdownTree()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ error: 'vault_unreachable', message }, { status: 502 })
    }

    if (tree.length === 0) {
      return NextResponse.json({ error: 'vault_empty' }, { status: 422 })
    }

    const vaultHash = computeVaultHash(tree)

    const cached = getCachedGraph(vaultHash)
    if (cached) return NextResponse.json(cached)

    // Stampede protection: if a build is in flight, wait for it
    if (buildInFlight) {
      await buildInFlight
      const fresh = getCachedGraph(vaultHash)
      if (fresh) return NextResponse.json(fresh)
    }

    let resolve!: () => void
    buildInFlight = new Promise<void>(r => { resolve = r })

    try {
      const files = await Promise.all(
        tree.map(async file => {
          const { content } = await client.readFile(file.path)
          return [file.path, content] as [string, string]
        })
      )

      const graph = buildGraph(files)
      setCachedGraph(graph, vaultHash)
      return NextResponse.json(graph)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      return NextResponse.json({ error: 'vault_unreachable', message }, { status: 502 })
    } finally {
      buildInFlight = null
      resolve()
    }
  })
}
