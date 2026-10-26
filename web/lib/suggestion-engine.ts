import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import type { VaultNote } from './types'
import { mapWithConcurrency } from './concurrency'
import {
  RELATION_TYPES, areLinked, pairKey, type RelationType, type ReviewProgress, type SuggestionKind,
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
          orphan: { type: 'string', description: 'path of the unconnected note' },
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
): Promise<SuggestionDraft[]> {
  const notes = reviewableNotes(input.notes)
  const byPath = new Map(notes.map(n => [n.path, n]))
  const isFocus = (path: string) => input.focusPaths === null || input.focusPaths.has(path)
  const fullScan = input.focusPaths === null
  if (notes.length < 2 || !notes.some(n => isFocus(n.path))) return []

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

Find candidate merges and missing relations. Skip pairs that already link to each other. Return at most ${MAX_CANDIDATES} candidates, best first; return an empty list when nothing stands out. A later step reads both notes in full before anything is shown, so include pairs you are fairly but not fully sure about.

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
  if (valid.length === 0) return []

  // Stage 2 — read the involved notes in full and decide per candidate, in parallel batches
  const batches: Candidate[][] = []
  for (let i = 0; i < valid.length; i += VERIFY_BATCH_SIZE) batches.push(valid.slice(i, i + VERIFY_BATCH_SIZE))
  let verified = 0
  onProgress?.({ phase: 'verifying', done: 0, total: valid.length })
  const results = await mapWithConcurrency(batches, VERIFY_CONCURRENCY, async batch => {
    const drafts = await verifyBatch(anthropic, batch, byPath)
    verified += batch.length
    onProgress?.({ phase: 'verifying', done: verified, total: valid.length })
    return drafts
  })
  return results.flat()
}

async function verifyBatch(
  anthropic: Anthropic,
  batch: Candidate[],
  byPath: Map<string, VaultNote>,
): Promise<SuggestionDraft[]> {
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
- reason: one short sentence the owner will read, in the language the notes are written in.
- confidence: 0 to 1, how sure you are the owner would approve.

<candidates>
${list}
</candidates>`,
    }],
  })

  const drafts: SuggestionDraft[] = []
  for (const d of decisions) {
    const c = batch[d.candidate - 1]
    if (!c || !d.accept || d.confidence < MIN_CONFIDENCE) continue
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
  return drafts
}

export interface OrphanInput {
  /** Notes without any link in either direction */
  orphans: VaultNote[]
  /** The owner's note plus the notes directly connected to it */
  network: VaultNote[]
  blockedKeys: Set<string>
}

/**
 * For each unconnected note, looks for the best note in the owner's network to connect it to.
 * Returns relation drafts (source = the unconnected note) and the paths for which no good match exists.
 */
export async function matchOrphans(
  anthropic: Anthropic,
  input: OrphanInput,
  onProgress?: (progress: ReviewProgress) => void,
): Promise<{ drafts: SuggestionDraft[]; unmatched: string[] }> {
  const { orphans, network, blockedKeys } = input
  if (orphans.length === 0 || network.length === 0) return { drafts: [], unmatched: orphans.map(o => o.path) }

  const networkPaths = new Set(network.map(n => n.path))
  const networkIndex = network.map(n => indexLine(n, false)).join('\n')
  const batches: VaultNote[][] = []
  for (let i = 0; i < orphans.length; i += ORPHAN_BATCH_SIZE) batches.push(orphans.slice(i, i + ORPHAN_BATCH_SIZE))

  let matched = 0
  onProgress?.({ phase: 'orphans', done: 0, total: orphans.length })
  const results = await mapWithConcurrency(batches, VERIFY_CONCURRENCY, async batch => {
    const excluded = batch.map(o => {
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
        content: `The notes below are not connected to anything in the vault. The owner wants every note linked to their own network: their own note or a note directly connected to it.

<network>
${networkIndex}
</network>

<unconnected>
${batch.map(fullNote).join('\n\n')}
</unconnected>
${excluded.length ? `\nAlready declined by the owner:\n${excluded.join('\n')}\n` : ''}
For each unconnected note, give one match: the network note it most clearly belongs to, or target "none" when no network note is a genuinely good fit. A forced link pollutes the graph, so "none" is the right answer when nothing fits; the owner will then look at the note themselves.

- relationType: "part_of" when the unconnected note is part of the target, "inspired_by" when it was inspired by the target, otherwise "works_with". Use "none" when target is "none".
- reason: one short sentence the owner will read, in the language the notes are written in.
- confidence: 0 to 1, how sure you are the owner would approve.`,
      }],
    })

    const drafts: SuggestionDraft[] = []
    const found = new Set<string>()
    for (const m of matches) {
      const orphan = batch.find(o => o.path === m.orphan)
      if (!orphan || found.has(orphan.path)) continue
      if (m.target === 'none' || m.relationType === 'none' || !networkPaths.has(m.target)) continue
      if (m.confidence < MIN_CONFIDENCE || blockedKeys.has(pairKey('relation', orphan.path, m.target))) continue
      found.add(orphan.path)
      drafts.push({
        kind: 'relation',
        source: orphan.path,
        target: m.target,
        relationType: m.relationType,
        reason: m.reason.trim(),
        confidence: Math.min(1, Math.max(0, m.confidence)),
      })
    }
    matched += batch.length
    onProgress?.({ phase: 'orphans', done: matched, total: orphans.length })
    return { drafts, unmatched: batch.filter(o => !found.has(o.path)).map(o => o.path) }
  })

  return { drafts: results.flatMap(r => r.drafts), unmatched: results.flatMap(r => r.unmatched) }
}
