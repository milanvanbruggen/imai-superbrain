import type Anthropic from '@anthropic-ai/sdk'
import type { VaultClient } from './vault-client'
import { buildGraph } from './vault-parser'
import { generateSuggestions } from './suggestion-engine'
import {
  areLinked, pairKey, pruneSuggestions, readSuggestionStore, writeSuggestionStore, type Suggestion,
} from './suggestions'

export interface ReviewResult {
  reviewedNotes: number
  focusNotes: number
  added: number
  pending: number
}

/**
 * One review run: reads the vault, finds notes that are new or changed since the last run,
 * asks Claude for merge/relation suggestions involving them, and stores the result in the vault.
 */
export async function runSuggestionReview(
  client: VaultClient,
  anthropic: Anthropic,
  { fullScan = false }: { fullScan?: boolean } = {},
): Promise<ReviewResult> {
  const [tree, { store }] = await Promise.all([client.getMarkdownTree(), readSuggestionStore(client)])

  const files = await Promise.all(
    tree.map(async f => [f.path, (await client.readFile(f.path)).content] as [string, string])
  )
  const notes = Object.values(buildGraph(files).notesByPath)
  const byPath = new Map(notes.map(n => [n.path, n]))

  const changedPaths = new Set(tree.filter(f => store.seen[f.path] !== f.sha).map(f => f.path))

  const existing = pruneSuggestions(store.suggestions, new Set(byPath.keys()), (s, t) => {
    const a = byPath.get(s)
    const b = byPath.get(t)
    return !!a && !!b && areLinked(a, b)
  })
  const blockedKeys = new Set(existing.map(s => pairKey(s.kind, s.source, s.target)))

  const drafts = await generateSuggestions(anthropic, { notes, focusPaths: fullScan ? null : changedPaths, blockedKeys })

  const now = new Date().toISOString()
  const added: Suggestion[] = drafts.map(d => ({
    ...d,
    id: pairKey(d.kind, d.source, d.target),
    createdAt: now,
    status: 'pending',
  }))

  // The owner may have accepted or dismissed suggestions while Claude was working —
  // re-read the store so those decisions aren't overwritten.
  const latest = await readSuggestionStore(client)
  const latestStatus = new Map(latest.store.suggestions.map(s => [s.id, s.status]))
  const suggestions = [...existing, ...added].map(s => ({ ...s, status: latestStatus.get(s.id) ?? s.status }))

  await writeSuggestionStore(
    client,
    { version: 1, lastRunAt: now, seen: Object.fromEntries(tree.map(f => [f.path, f.sha])), suggestions },
    latest.sha,
    `brain: AI review — ${added.length} new suggestion${added.length === 1 ? '' : 's'}`,
  )

  return {
    reviewedNotes: notes.length,
    focusNotes: fullScan ? notes.length : changedPaths.size,
    added: added.length,
    pending: suggestions.filter(s => s.status === 'pending').length,
  }
}
