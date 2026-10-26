import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import type { VaultNote } from './types'
import { mapWithConcurrency } from './concurrency'
import {
  RELATION_TYPES, areLinked, pairKey,
  type RejectedCandidate, type RelationType, type ReviewProgress, type SuggestionKind,
} from './suggestions'

export const SUGGESTION_MODEL = 'claude-opus-5-5'
export const MIN_CONFIDENCE = 0.6
const MAX_CANDIDATES = 40
const EXCERPT_CHARS = 280
const MAX_NOTE_CHARS = 12_000
// Stage 2 checks candidates in small parallel batches: faster, and progress can be reported per batch
const VERIFY_BATCH_SIZE = 5
const VERIFY_CONCURRENCY = 4
// Unconnected notes are matched against the owner's network in batches as well
const ORPHAN_BATCH_SIZE = 8
// Notes of an island sent in full; the rest of a bigger island is listed by title and excerpt
const MAX_GROUP_NOTES = 5

export interface SuggestionDraft {
  kind: SuggestionKind
  source: string
  target: string
  relationType?: RelationType
  reason: string
  confidence: number
}

export interface ReviewInput {
  notes: VaultNote[]
  /** Notes new or changed since the last run; every suggestion involves at least one of them. null = review all notes. */
  focusPaths: Set<string> | null
  /** pairKey()s that must not be suggested again (dismissed, accepted or already pending). */
  blockedKeys: Set<string>
}

/** Notes worth reviewing: inbox items have their own review flow, system/template notes aren't content. */
export function reviewableNotes(notes: VaultNote[]): VaultNote[] {
  return notes.filter(n => !n.inbox && n.type !== 'system' && n.type !== 'template')
}

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_CHARS ? flat.slice(0, EXCERPT_CHARS) + '…' : flat
}

function indexLine(n: VaultNote, focus: boolean): string {
  const relations = n.relations.map(r => (r.type ? `${r.type}:${r.target}` : r.target))
  return [
    focus ? 'FOCUS' : '-',
    n.path,
    `title=${JSON.stringify(n.title)}`,
    `type=${n.type}`,
    n.tags.length ? `tags=${n.tags.join(',')}` : '',
    relations.length ? `relations=${relations.join(',')}` : '',
    `excerpt=${JSON.stringify(excerpt(n.content))}`,
  ].filter(Boolean).join(' | ')
}

function fullNote(n: VaultNote): string {
  const body = n.content.length > MAX_NOTE_CHARS
    ? n.content.slice(0, MAX_NOTE_CHARS) + '\n[… rest of this note omitted for length …]'
    : n.content
  const relations = n.relations.map(r => (r.type ? `${r.type}: ${r.target}` : r.target)).join(', ') || 'none'
  return `<note path=${JSON.stringify(n.path)} title=${JSON.stringify(n.title)} type="${n.type}" tags="${n.tags.join(', ')}" relations="${relations}">\n${body}\n</note>`
}

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['merge', 'relation'] },
          a: { type: 'string', description: 'path of the first note' },
          b: { type: 'string', description: 'path of the second note' },
        },
        required: ['kind', 'a', 'b'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate: { type: 'integer', description: 'number of the candidate being judged' },
          accept: { type: 'boolean' },
          source: { type: 'string', description: 'path; merge: note merged away, relation: note that holds the relation' },
          target: { type: 'string', description: 'path; merge: note that remains, relation: note linked to' },
          relationType: { type: 'string', enum: [...RELATION_TYPES, 'none'] },
          reason: { type: 'string' },
          confidence: { type: 'number', description: '0 to 1' },
        },
        required: ['candidate', 'accept', 'source', 'target', 'relationType', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You maintain a personal knowledge vault of markdown notes (people, projects, ideas, meetings, resources). You look for two kinds of maintenance work:

- merge: two notes describe the same thing — the same person, organisation, project or idea — and should be a single note.
- relation: two notes are about clearly connected things but neither links to the other yet.

Your suggestions are shown to the vault owner for approval, and a merge deletes one of the two notes, so be conservative. Only suggest what a careful human who knows the vault would agree with. A shared tag or a vague thematic overlap is not enough for a relation: the notes must concern the same concrete person, project, event or organisation, or one must be part of or directly inspired by the other. Two different people who share a first name are not a merge.`

const ORPHAN_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          orphan: { type: 'string', description: 'path of the note in the group that gets the link' },
          target: { type: 'string', description: 'path of the best note from the network, or "none"' },
          relationType: { type: 'string', enum: [...RELATION_TYPES, 'none'] },
          reason: { type: 'string' },
          confidence: { type: 'number', description: '0 to 1' },
        },
        required: ['orphan', 'target', 'relationType', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
} as const

type ParseParams = Parameters<Anthropic['messages']['parse']>[0]

async function ask<T>(anthropic: Anthropic, params: ParseParams): Promise<T> {
  const response = await anthropic.messages.parse(
    // Server-side fallback reroutes the request when a safety classifier declines it.
    // Not yet typed in this SDK version, so it is passed through as an extra body field.
    { ...params, ...({ fallbacks: 'default' } as object) } as ParseParams,
    { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } },
  )
  if (response.stop_reason === 'refusal') throw new Error('Claude declined the vault review request')
  if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off (max_tokens)')
  if (!response.parsed_output) throw new Error('Claude returned no structured output')
  return response.parsed_output as T
}

type Candidate = { kind: SuggestionKind; a: string; b: string }

export async function generateSuggestions(
  anthropic: Anthropic,
  input: ReviewInput,
  onProgress?: (progress: ReviewProgress) => void,
): Promise<{ drafts: SuggestionDraft[]; rejected: RejectedCandidate[]; scanned: boolean }> {
  const notes = reviewableNotes(input.notes)
  const byPath = new Map(notes.map(n => [n.path, n]))
  const isFocus = (path: string) => input.focusPaths === null || input.focusPaths.has(path)
  const fullScan = input.focusPaths === null
  if (notes.length < 2 || !notes.some(n => isFocus(n.path))) return { drafts: [], rejected: [], scanned: false }

  // Stage 1 — scan a compact index of the whole vault for candidate pairs
  const index = notes.map(n => indexLine(n, !fullScan && isFocus(n.path))).join('\n')
  const scope = fullScan
    ? 'Review the whole vault.'
    : 'Notes marked FOCUS are new or changed since the last review. Every candidate must involve at least one FOCUS note.'

  onProgress?.({ phase: 'scanning', notes: notes.length })
  const { candidates } = await ask<{ candidates: Candidate[] }>(anthropic, {
    model: SUGGESTION_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: jsonSchemaOutputFormat(CANDIDATE_SCHEMA) },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Below is an index of every note in the vault, one per line. ${scope}

Find candidate merges and missing relations. Notes can describe the same thing under different titles or types, for example an abbreviation and the full name. For relations, skip pairs that already link to each other; for merges, a link between the two notes is no reason to skip them. Return at most ${MAX_CANDIDATES} candidates, best first; return an empty list when nothing stands out. A later step reads both notes in full before anything is shown, so include pairs you are fairly but not fully sure about.

<index>
${index}
</index>`,
    }],
  })

  const seen = new Set<string>()
  const valid = candidates.filter(c => {
    const a = byPath.get(c.a)
    const b = byPath.get(c.b)
    if (!a || !b || a === b) return false
    if (!isFocus(a.path) && !isFocus(b.path)) return false
    const key = pairKey(c.kind, a.path, b.path)
    if (seen.has(key) || input.blockedKeys.has(key)) return false
    if (c.kind === 'relation' && areLinked(a, b)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_CANDIDATES)
  if (valid.length === 0) return { drafts: [], rejected: [], scanned: true }

  // Stage 2 — read the involved notes in full and decide per candidate, in parallel batches
  const batches: Candidate[][] = []
  for (let i = 0; i < valid.length; i += VERIFY_BATCH_SIZE) batches.push(valid.slice(i, i + VERIFY_BATCH_SIZE))
  let verified = 0
  onProgress?.({ phase: 'verifying', done: 0, total: valid.length })
  const results = await mapWithConcurrency(batches, VERIFY_CONCURRENCY, async batch => {
    const result = await verifyBatch(anthropic, batch, byPath)
    verified += batch.length
    onProgress?.({ phase: 'verifying', done: verified, total: valid.length })
    return result
  })
  return {
    drafts: results.flatMap(r => r.drafts),
    rejected: results.flatMap(r => r.rejected),
    scanned: true,
  }
}

async function verifyBatch(
  anthropic: Anthropic,
  batch: Candidate[],
  byPath: Map<string, VaultNote>,
): Promise<{ drafts: SuggestionDraft[]; rejected: RejectedCandidate[] }> {
  const involved = [...new Set(batch.flatMap(c => [c.a, c.b]))].map(p => byPath.get(p)!)
  const list = batch.map((c, i) => `${i + 1}. ${c.kind}: ${c.a} ↔ ${c.b}`).join('\n')
  const { decisions } = await ask<{ decisions: {
    candidate: number; accept: boolean; source: string; target: string
    relationType: RelationType | 'none'; reason: string; confidence: number
  }[] }>(anthropic, {
    model: SUGGESTION_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: jsonSchemaOutputFormat(DECISION_SCHEMA) },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `<notes>
${involved.map(fullNote).join('\n\n')}
</notes>

Judge each candidate below with the full notes above. Give one decision per candidate.

- merge: set target to the note that should remain (the more complete or canonical one) and source to the note merged into it. relationType is "none".
- relation: set source to the note that should hold the relation and target to the note it links to. Pick relationType: "part_of" when source is part of target, "inspired_by" when source was inspired by target, otherwise "works_with" for people, organisations or projects that work together or belong together.
- If a merge candidate is really just related, reject it rather than changing its kind.
- reason: one short sentence the owner will read, in the language the notes are written in. For an accepted candidate say why; for a rejected one say why not.
- confidence: 0 to 1, how sure you are the owner would approve.

<candidates>
${list}
</candidates>`,
    }],
  })

  const drafts: SuggestionDraft[] = []
  const rejected: RejectedCandidate[] = []
  for (const d of decisions) {
    const c = batch[d.candidate - 1]
    if (!c) continue
    if (!d.accept || d.confidence < MIN_CONFIDENCE) {
      rejected.push({ kind: c.kind, a: c.a, b: c.b, reason: d.reason.trim() })
      continue
    }
    // source/target must be the candidate pair, in either order
    const pair = new Set([c.a, c.b])
    if (!pair.has(d.source) || !pair.has(d.target) || d.source === d.target) continue
    if (c.kind === 'relation' && d.relationType === 'none') continue
    drafts.push({
      kind: c.kind,
      source: d.source,
      target: d.target,
      ...(c.kind === 'relation' ? { relationType: d.relationType as RelationType } : {}),
      reason: d.reason.trim(),
      confidence: Math.min(1, Math.max(0, d.confidence)),
    })
  }
  return { drafts, rejected }
}

export interface OrphanInput {
  /**
   * Groups of notes that no path connects to the owner's network: a single note without links,
   * or an island of notes that only link to each other. Best-connected note first.
   */
  groups: VaultNote[][]
  /** The owner's note plus the notes directly connected to it */
  network: VaultNote[]
  blockedKeys: Set<string>
}

/**
 * For each detached group, looks for one link from one of its notes to the owner's network:
 * once one note is linked, the whole group is connected.
 * Returns relation drafts (source = the note in the group) and, for groups without a good match,
 * the path of their best-connected note.
 */
export async function matchOrphans(
  anthropic: Anthropic,
  input: OrphanInput,
  onProgress?: (progress: ReviewProgress) => void,
): Promise<{ drafts: SuggestionDraft[]; unmatched: string[] }> {
  const groups = input.groups.filter(g => g.length > 0)
  const { network, blockedKeys } = input
  if (groups.length === 0 || network.length === 0) return { drafts: [], unmatched: groups.map(g => g[0].path) }

  const networkPaths = new Set(network.map(n => n.path))
  const networkIndex = network.map(n => indexLine(n, false)).join('\n')
  // Batches hold up to ORPHAN_BATCH_SIZE notes in full, so a few islands share a request
  const batches: VaultNote[][][] = [[]]
  let inBatch = 0
  for (const g of groups) {
    const size = Math.min(g.length, MAX_GROUP_NOTES)
    if (inBatch > 0 && inBatch + size > ORPHAN_BATCH_SIZE) { batches.push([]); inBatch = 0 }
    batches[batches.length - 1].push(g)
    inBatch += size
  }

  const groupText = (g: VaultNote[], i: number) => {
    const rest = g.slice(MAX_GROUP_NOTES)
    return `<group id="${i + 1}">\n${g.slice(0, MAX_GROUP_NOTES).map(fullNote).join('\n\n')}${
      rest.length ? `\nAlso in this group:\n${rest.map(n => indexLine(n, false)).join('\n')}` : ''
    }\n</group>`
  }

  let matched = 0
  onProgress?.({ phase: 'orphans', done: 0, total: groups.length })
  const results = await mapWithConcurrency(batches, VERIFY_CONCURRENCY, async batch => {
    const excluded = batch.flat().map(o => {
      const blocked = network.filter(n => blockedKeys.has(pairKey('relation', o.path, n.path))).map(n => n.path)
      return blocked.length ? `- ${o.path}: do not suggest ${blocked.join(', ')} (the owner already declined these)` : ''
    }).filter(Boolean)

    const { matches } = await ask<{ matches: {
      orphan: string; target: string; relationType: RelationType | 'none'; reason: string; confidence: number
    }[] }>(anthropic, {
      model: SUGGESTION_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: jsonSchemaOutputFormat(ORPHAN_SCHEMA) },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `The groups of notes below are not connected to the owner's network by any path of links. A group is either a single note without any links, or a few notes that only link to each other. The owner wants every note linked to their own network: their own note or a note directly connected to it.

<network>
${networkIndex}
</network>

<unconnected>
${batch.map(groupText).join('\n\n')}
</unconnected>
${excluded.length ? `\nAlready declined by the owner:\n${excluded.join('\n')}\n` : ''}
For each group, give one match: the note in the group that should carry the link (orphan) and the network note it most clearly belongs to (target), or target "none" when no network note is a genuinely good fit. One link per group is enough, since it connects the whole group. A forced link pollutes the graph, so "none" is the right answer when nothing fits; the owner will then look at the notes themselves.

- orphan: the path of the note in the group that fits the target best.
- relationType: "part_of" when that note is part of the target, "inspired_by" when it was inspired by the target, otherwise "works_with". Use "none" when target is "none".
- reason: one short sentence the owner will read, in the language the notes are written in.
- confidence: 0 to 1, how sure you are the owner would approve.`,
      }],
    })

    const drafts: SuggestionDraft[] = []
    const found = new Set<VaultNote[]>()
    for (const m of matches) {
      const group = batch.find(g => g.some(n => n.path === m.orphan))
      if (!group || found.has(group)) continue
      if (m.target === 'none' || m.relationType === 'none' || !networkPaths.has(m.target)) continue
      if (m.confidence < MIN_CONFIDENCE || blockedKeys.has(pairKey('relation', m.orphan, m.target))) continue
      found.add(group)
      drafts.push({
        kind: 'relation',
        source: m.orphan,
        target: m.target,
        relationType: m.relationType,
        reason: m.reason.trim(),
        confidence: Math.min(1, Math.max(0, m.confidence)),
      })
    }
    matched += batch.length
    onProgress?.({ phase: 'orphans', done: matched, total: groups.length })
    return { drafts, unmatched: batch.filter(g => !found.has(g)).map(g => g[0].path) }
  })

  return { drafts: results.flatMap(r => r.drafts), unmatched: results.flatMap(r => r.unmatched) }
}
