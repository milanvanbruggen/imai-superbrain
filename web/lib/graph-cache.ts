import { VaultGraph } from './types'

let cachedGraph: VaultGraph | null = null
let cachedHash: string | null = null

/** Returns cached graph only if the vault hash matches — otherwise null. */
export function getCachedGraph(vaultHash: string): VaultGraph | null {
  if (!cachedGraph || cachedHash !== vaultHash) return null
  return cachedGraph
}

/** Returns whatever is in cache right now, regardless of hash (for secondary routes). */
export function getCachedGraphIfAvailable(): VaultGraph | null {
  return cachedGraph
}

export function setCachedGraph(graph: VaultGraph, vaultHash: string): void {
  cachedGraph = graph
  cachedHash = vaultHash
}

export function invalidateCache(): void {
  cachedGraph = null
  cachedHash = null
}

/** Stable hash from a vault tree — any file change changes the hash. */
export function computeVaultHash(tree: { path: string; sha: string }[]): string {
  return tree
    .map(f => `${f.path}:${f.sha}`)
    .sort()
    .join('|')
}
