import type Anthropic from '@anthropic-ai/sdk'
import type { VaultClient } from './vault-client'
import { buildGraph, parseNote } from './vault-parser'
import { mapWithConcurrency } from './concurrency'
import { generateSuggestions, matchOrphans, reviewableNotes } from './suggestion-engine'
import { readVaultPreferences } from './vault-preferences'
import {
  areLinked, pairKey, pruneSuggestions, readSuggestionStore, unconnectedPaths, writeSuggestionStore,
  type RelationType, type ReviewProgress, type Suggestion, type SuggestionKind,
} from './suggestions'

const READ_CONCURRENCY = 10

export interface ReviewResult {
  reviewedNotes: number
  focusNotes: number
  added: number
  pending: number
  /** Unconnected notes without a good match, left for manual review */
  unlinked: number
  /** false when no owner note is set, so unconnected notes were not checked */
  ownerNoteSet: boolean
}

/**
 * One review run: reads the vault, finds notes that are new or changed since the last run,
 * asks Claude for merge/relation suggestions involving them, and stores the result in the vault.
 */
export async function runSuggestionReview(
  client: VaultClient,
  anthropic: Anthropic,
  { fullScan = false, onProgress }: { fullScan?: boolean; onProgress?: (progress: ReviewProgress) => void } = {},
): Promise<ReviewResult> {
  const [tree, { store }, { prefs }] = await Promise.all([
    client.getMarkdownTree(), readSuggestionStore(client), readVaultPreferences(client),
  ])

  // A bounded number of parallel reads keeps GitHub's secondary rate limit happy and lets us count progress
  let read = 0
  onProgress?.({ phase: 'reading', done: 0, total: tree.length })
  const files = await mapWithConcurrency(tree, READ_CONCURRENCY, async f => {
    const { content } = await client.readFile(f.path)
    read++
    if (read % 10 === 0 || read === tree.length) onProgress?.({ phase: 'reading', done: read, total: tree.length })
    return [f.path, content] as [string, string]
  })
  const graph = buildGraph(files)
  const notes = Object.values(graph.notesByPath)
  const byPath = new Map(notes.map(n => [n.path, n]))

  const changedPaths = new Set(tree.filter(f => store.seen[f.path] !== f.sha).map(f => f.path))

  const existing = pruneSuggestions(store.suggestions, new Set(byPath.keys()), (s, t) => {
    const a = byPath.get(s)
    const b = byPath.get(t)
    return !!a && !!b && areLinked(a, b)
  })
  const blockedKeys = new Set(existing.map(s => pairKey(s.kind, s.source, s.target)))

  const drafts = await generateSuggestions(anthropic, { notes, focusPaths: fullScan ? null : changedPaths, blockedKeys }, onProgress)

  // Unconnected notes: try to link each one to the owner's note or a note directly connected to it
  const owner = prefs.ownerNote ? byPath.get(prefs.ownerNote) : undefined
  let unlinked: string[] = []
  if (owner) {
    const unconnected = unconnectedPaths(graph.nodes, graph.edges)
    const pendingPaths = new Set([
      ...existing.filter(s => s.status === 'pending').flatMap(s => [s.source, s.target]),
      ...drafts.flatMap(d => [d.source, d.target]),
    ])
    const candidates = reviewableNotes(notes).filter(n =>
      unconnected.has(n.path) && n.path !== owner.path && !pendingPaths.has(n.path))
    // Incremental runs don't re-ask about unchanged notes that already had no match last time
    const previouslyUnmatched = new Set(store.unlinked ?? [])
    const orphans = fullScan
      ? candidates
      : candidates.filter(n => changedPaths.has(n.path) || !previouslyUnmatched.has(n.path))
    const carriedOver = candidates.filter(n => !orphans.includes(n)).map(n => n.path)

    const neighbours = new Set(graph.edges.flatMap(e =>
      e.source === owner.path ? [e.target] : e.target === owner.path ? [e.source] : []))
    const network = [owner, ...reviewableNotes(notes).filter(n => neighbours.has(n.path))]

    const orphanBlocked = new Set([...blockedKeys, ...drafts.map(d => pairKey(d.kind, d.source, d.target))])
    const matched = await matchOrphans(anthropic, { orphans, network, blockedKeys: orphanBlocked }, onProgress)
    drafts.push(...matched.drafts)
    unlinked = [...carriedOver, ...matched.unmatched]
  }

  const now = new Date().toISOString()
  const added: Suggestion[] = drafts.map(d => ({
    ...d,
    id: pairKey(d.kind, d.source, d.target),
    createdAt: now,
    status: 'pending',
  }))

  onProgress?.({ phase: 'saving' })

  // The owner may have accepted or dismissed suggestions while Claude was working —
  // re-read the store so those decisions aren't overwritten.
  const latest = await readSuggestionStore(client)
  const latestStatus = new Map(latest.store.suggestions.map(s => [s.id, s.status]))
  const suggestions = [...existing, ...added].map(s => ({ ...s, status: latestStatus.get(s.id) ?? s.status }))

  await writeSuggestionStore(
    client,
    { version: 1, lastRunAt: now, seen: Object.fromEntries(tree.map(f => [f.path, f.sha])), suggestions, unlinked },
    latest.sha,
    `brain: AI review — ${added.length} new suggestion${added.length === 1 ? '' : 's'}`,
  )

  return {
    reviewedNotes: notes.length,
    focusNotes: fullScan ? notes.length : changedPaths.size,
    added: added.length,
    pending: suggestions.filter(s => s.status === 'pending').length,
    unlinked: unlinked.length,
    ownerNoteSet: !!owner,
  }
}

export type FileSuggestionResult =
  | { status: 'added' | 'reopened' | 'already_pending'; suggestion: Suggestion }
  | { status: 'already_linked' | 'not_found' | 'invalid'; message: string }

/**
 * Files one suggestion requested from a conversation (MCP). Unlike the automatic review this
 * re-opens a pair that was dismissed before: the owner is explicitly asking about it.
 */
export async function fileSuggestion(
  client: VaultClient,
  request: { kind: SuggestionKind; source: string; target: string; relationType?: RelationType; reason: string },
): Promise<FileSuggestionResult> {
  const { kind, source, target, relationType, reason } = request
  if (source === target) return { status: 'invalid', message: 'source and target are the same note' }
  if (kind === 'relation' && !relationType) return { status: 'invalid', message: 'relationType is required for a relation' }

  const notes = await Promise.all([source, target].map(async path => {
    try {
      return parseNote(path, (await client.readFile(path)).content)
    } catch {
      return null
    }
  }))
  const missing = [source, target].filter((_, i) => !notes[i])
  if (missing.length) return { status: 'not_found', message: `Note not found: ${missing.join(', ')}` }
  if (kind === 'relation' && areLinked(notes[0]!, notes[1]!)) {
    return { status: 'already_linked', message: 'These notes already link to each other' }
  }

  const { store, sha } = await readSuggestionStore(client)
  const id = pairKey(kind, source, target)
  const fresh: Suggestion = {
    id, kind, source, target,
    ...(kind === 'relation' ? { relationType } : {}),
    reason: reason.trim(),
    confidence: 1,
    createdAt: new Date().toISOString(),
    status: 'pending',
    origin: 'chat',
  }
  const index = store.suggestions.findIndex(s => s.id === id)
  const previous = index >= 0 ? store.suggestions[index] : null
  if (previous?.status === 'pending') return { status: 'already_pending', suggestion: previous }

  if (index >= 0) store.suggestions[index] = fresh
  else store.suggestions.push(fresh)
  await writeSuggestionStore(client, store, sha, `brain: suggestion from chat — ${kind} [[${notes[0]!.stem}]] → [[${notes[1]!.stem}]]`)
  return { status: previous ? 'reopened' : 'added', suggestion: fresh }
}
