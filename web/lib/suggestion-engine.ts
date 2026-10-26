import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import type { VaultNote } from './types'
import { RELATION_TYPES, areLinked, pairKey, type RelationType, type SuggestionKind } from './suggestions'

export const SUGGESTION_MODEL = 'claude-opus-5-5'
export const MIN_CONFIDENCE = 0.6
const MAX_CANDIDATES = 40
const EXCERPT_CHARS = 280
const MAX_NOTE_CHARS = 12_000

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

export async function generateSuggestions(anthropic: Anthropic, input: ReviewInput): Promise<SuggestionDraft[]> {
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

  const { candidates } = await ask<{ candidates: { kind: SuggestionKind; a: string; b: string }[] }>(anthropic, {
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

  // Stage 2 — read the involved notes in full and decide per candidate
  const involved = [...new Set(valid.flatMap(c => [c.a, c.b]))].map(p => byPath.get(p)!)
  const list = valid.map((c, i) => `${i + 1}. ${c.kind}: ${c.a} ↔ ${c.b}`).join('\n')
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
    const c = valid[d.candidate - 1]
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
