import type { VaultClient } from './vault-client'
import type { VaultNote } from './types'

// AI review suggestions live as JSON inside the vault, so they work on Vercel
// (no writable disk) and travel with the vault. Obsidian ignores dot-folders.
export const SUGGESTIONS_PATH = '.superbrain/suggestions.json'

// Relation types the UI offers (see DetailPanel). The AI may only pick from these.
export const RELATION_TYPES = ['works_with', 'part_of', 'inspired_by'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export type SuggestionKind = 'merge' | 'relation'
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed'

export interface Suggestion {
  id: string
  kind: SuggestionKind
  /** merge: the note that gets merged away. relation: the note that gets the relation in its frontmatter. */
  source: string
  /** merge: the note that remains. relation: the note being linked to. */
  target: string
  relationType?: RelationType
  reason: string
  confidence: number
  createdAt: string
  status: SuggestionStatus
  /** 'chat' when filed through the MCP tools from a conversation; absent for the automatic review */
  origin?: 'review' | 'chat'
}

/** A candidate pair Claude looked at in full during the last run and decided not to suggest */
export interface RejectedCandidate {
  kind: SuggestionKind
  a: string
  b: string
  reason: string
}

/** Live progress of a review run, streamed to the Inbox while a manual scan runs. */
export type ReviewProgress =
  | { phase: 'reading'; done: number; total: number }
  | { phase: 'scanning'; notes: number }
  | { phase: 'verifying'; done: number; total: number }
  | { phase: 'orphans'; done: number; total: number }
  | { phase: 'saving' }

export interface SuggestionStore {
  version: 1
  lastRunAt: string | null
  /** path → blob sha at the last run, used to find notes that changed since then */
  seen: Record<string, string>
  suggestions: Suggestion[]
  /** Notes without any link for which the last run found no good match — shown for manual review */
  unlinked?: string[]
  /** Candidates the last run that looked for candidates considered and rejected, with Claude's reason */
  rejected?: RejectedCandidate[]
}

/** True when either note already links to the other, via a frontmatter relation or a body wikilink. */
export function areLinked(a: VaultNote, b: VaultNote): boolean {
  const links = (n: VaultNote) => new Set([...n.relations.map(r => r.target), ...n.wikilinks].map(s => s.toLowerCase()))
  return links(a).has(b.stem.toLowerCase()) || links(b).has(a.stem.toLowerCase())
}

/** Pending suggestions that still make sense against the current graph (notes exist, not yet linked). */
export function visibleSuggestions(suggestions: Suggestion[], notesByPath: Record<string, VaultNote>): Suggestion[] {
  return suggestions.filter(s => {
    if (s.status !== 'pending') return false
    const a = notesByPath[s.source]
    const b = notesByPath[s.target]
    if (!a || !b) return false
    return s.kind === 'merge' || !areLinked(a, b)
  })
}

/** Paths of notes with no relation or wikilink in either direction, judged on the current graph. */
export function unconnectedPaths(nodes: { id: string; path: string }[], edges: { source: string; target: string }[]): Set<string> {
  const linked = new Set<string>()
  for (const e of edges) {
    if (e.source === e.target) continue
    linked.add(e.source)
    linked.add(e.target)
  }
  return new Set(nodes.filter(n => !linked.has(n.id)).map(n => n.path))
}

export function emptyStore(): SuggestionStore {
  return { version: 1, lastRunAt: null, seen: {}, suggestions: [] }
}

/** Order-independent key for a pair of notes, so A↔B and B↔A count as the same suggestion. */
export function pairKey(kind: SuggestionKind, a: string, b: string): string {
  const [x, y] = [a, b].sort()
  return `${kind}:${x}|${y}`
}

export async function readSuggestionStore(client: VaultClient): Promise<{ store: SuggestionStore; sha: string | null }> {
  try {
    const { content, sha } = await client.readFile(SUGGESTIONS_PATH)
    const parsed = JSON.parse(content) as SuggestionStore
    if (parsed?.version !== 1 || !Array.isArray(parsed.suggestions)) return { store: emptyStore(), sha }
    return { store: { ...emptyStore(), ...parsed }, sha }
  } catch {
    // Missing file (first run) or unreadable content — start fresh
    return { store: emptyStore(), sha: null }
  }
}

export async function writeSuggestionStore(
  client: VaultClient,
  store: SuggestionStore,
  sha: string | null,
  message: string,
): Promise<void> {
  await client.writeFile(SUGGESTIONS_PATH, JSON.stringify(store, null, 2) + '\n', sha, message)
}

/**
 * Drops suggestions that no longer apply: one of the notes is gone (merged, deleted, renamed),
 * or a pending relation already exists. Dismissed and accepted suggestions for notes that
 * still exist are kept, so the same pair is never suggested again.
 */
export function pruneSuggestions(
  suggestions: Suggestion[],
  existingPaths: Set<string>,
  hasRelation: (source: string, target: string) => boolean,
): Suggestion[] {
  return suggestions.filter(s => {
    if (!existingPaths.has(s.source) || !existingPaths.has(s.target)) return false
    if (s.status === 'pending' && s.kind === 'relation' && hasRelation(s.source, s.target)) return false
    return true
  })
}
