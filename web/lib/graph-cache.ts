// web/lib/graph-cache.ts
import { VaultGraph } from './types'

const TTL_MS = 5 * 60 * 1000 // 5 minutes

let cached: VaultGraph | null = null

export function getCachedGraph(): VaultGraph | null {
  if (!cached) return null
  if (Date.now() - cached.builtAt > TTL_MS) return null
  return cached
}

export function setCachedGraph(graph: VaultGraph): void {
  cached = graph
}

export function invalidateCache(): void {
  cached = null
}
