import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { parseNote } from '../vault-parser'
import { areLinked, pairKey, pruneSuggestions, visibleSuggestions, SUGGESTIONS_PATH, type Suggestion } from '../suggestions'
import { generateSuggestions, MIN_CONFIDENCE } from '../suggestion-engine'
import { runSuggestionReview } from '../suggestion-review'
import { mapWithConcurrency } from '../concurrency'
import type { VaultClient } from '../vault-client'

const jan = parseNote('people/Jan.md', '---\ntype: person\n---\nJan works on [[Superbrain]].')
const janDup = parseNote('people/Jan de Vries.md', '---\ntype: person\n---\nJan de Vries, developer.')
const superbrain = parseNote('projects/Superbrain.md', '---\ntype: project\n---\nKnowledge graph app.')
const idea = parseNote('ideas/Graph search.md', '---\ntype: idea\n---\nSearch the graph.')

function suggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    id: 'x', kind: 'relation', source: idea.path, target: superbrain.path, relationType: 'part_of',
    reason: 'r', confidence: 0.9, createdAt: '2026-10-01T00:00:00Z', status: 'pending', ...overrides,
  }
}

/** Fake Anthropic client whose messages.parse returns the given parsed outputs in order. */
function fakeAnthropic(...outputs: unknown[]) {
  const parse = vi.fn()
  for (const output of outputs) parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: output })
  return { client: { messages: { parse } } as unknown as Anthropic, parse }
}

describe('suggestion helpers', () => {
  it('pairKey ignores order', () => {
    expect(pairKey('merge', 'a.md', 'b.md')).toBe(pairKey('merge', 'b.md', 'a.md'))
    expect(pairKey('merge', 'a.md', 'b.md')).not.toBe(pairKey('relation', 'a.md', 'b.md'))
  })

  it('areLinked sees wikilinks and relations in both directions', () => {
    expect(areLinked(jan, superbrain)).toBe(true)
    expect(areLinked(superbrain, jan)).toBe(true)
    expect(areLinked(idea, superbrain)).toBe(false)
  })

  it('prune drops suggestions for missing notes and relations that now exist', () => {
    const paths = new Set([jan.path, superbrain.path, idea.path])
    const kept = pruneSuggestions([
      suggestion({ id: 'gone', target: 'people/Deleted.md' }),
      suggestion({ id: 'linked', source: jan.path, target: superbrain.path }),
      suggestion({ id: 'open' }),
      suggestion({ id: 'dismissed', status: 'dismissed' }),
    ], paths, () => false)
    expect(kept.map(s => s.id)).toEqual(['linked', 'open', 'dismissed'])

    const afterLinking = pruneSuggestions([suggestion({ id: 'open' })], paths, () => true)
    expect(afterLinking).toEqual([])
  })

  it('visibleSuggestions hides non-pending, stale and already-linked ones', () => {
    const notesByPath = Object.fromEntries([jan, superbrain, idea].map(n => [n.path, n]))
    const visible = visibleSuggestions([
      suggestion({ id: 'open' }),
      suggestion({ id: 'linked', source: jan.path, target: superbrain.path }),
      suggestion({ id: 'dismissed', status: 'dismissed' }),
      suggestion({ id: 'gone', source: 'x.md' }),
    ], notesByPath)
    expect(visible.map(s => s.id)).toEqual(['open'])
  })
})

describe('generateSuggestions', () => {
  const notes = [jan, janDup, superbrain, idea]

  it('keeps only verified, confident candidates involving a focus note', async () => {
    const { client, parse } = fakeAnthropic(
      { candidates: [
        { kind: 'merge', a: jan.path, b: janDup.path },
        { kind: 'relation', a: idea.path, b: superbrain.path },
        { kind: 'relation', a: jan.path, b: superbrain.path },   // already linked
        { kind: 'relation', a: 'people/Ghost.md', b: idea.path }, // unknown note
      ] },
      { decisions: [
        { candidate: 1, accept: true, source: janDup.path, target: jan.path, relationType: 'none', reason: 'Same person', confidence: 0.9 },
        { candidate: 2, accept: true, source: idea.path, target: superbrain.path, relationType: 'part_of', reason: 'Feature idea', confidence: MIN_CONFIDENCE - 0.1 },
      ] },
    )

    const drafts = await generateSuggestions(client, {
      notes, focusPaths: new Set([janDup.path, idea.path]), blockedKeys: new Set(),
    })

    expect(drafts).toEqual([
      { kind: 'merge', source: janDup.path, target: jan.path, reason: 'Same person', confidence: 0.9 },
    ])
    // Stage 2 only sees the two valid candidates
    const stage2 = parse.mock.calls[1][0].messages[0].content as string
    expect(stage2).toContain(`1. merge: ${jan.path} ↔ ${janDup.path}`)
    expect(stage2).toContain(`2. relation: ${idea.path} ↔ ${superbrain.path}`)
    expect(stage2).not.toContain('3.')
  })

  it('skips blocked pairs and pairs without a focus note', async () => {
    const { client, parse } = fakeAnthropic({ candidates: [
      { kind: 'merge', a: jan.path, b: janDup.path },
      { kind: 'relation', a: idea.path, b: superbrain.path },
    ] })

    const drafts = await generateSuggestions(client, {
      notes,
      focusPaths: new Set([janDup.path]),
      blockedKeys: new Set([pairKey('merge', janDup.path, jan.path)]),
    })

    expect(drafts).toEqual([])
    expect(parse).toHaveBeenCalledTimes(1) // nothing left to verify
  })

  it('rejects decisions whose paths are not the candidate pair', async () => {
    const { client } = fakeAnthropic(
      { candidates: [{ kind: 'relation', a: idea.path, b: superbrain.path }] },
      { decisions: [{ candidate: 1, accept: true, source: idea.path, target: jan.path, relationType: 'works_with', reason: 'r', confidence: 0.9 }] },
    )
    const drafts = await generateSuggestions(client, { notes, focusPaths: null, blockedKeys: new Set() })
    expect(drafts).toEqual([])
  })

  it('marks FOCUS notes for incremental runs but not for a full scan', async () => {
    const incremental = fakeAnthropic({ candidates: [] })
    await generateSuggestions(incremental.client, { notes, focusPaths: new Set([idea.path]), blockedKeys: new Set() })
    const prompt = incremental.parse.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain(`FOCUS | ${idea.path}`)
    expect(prompt).toContain('Every candidate must involve at least one FOCUS note')

    const full = fakeAnthropic({ candidates: [] })
    await generateSuggestions(full.client, { notes, focusPaths: null, blockedKeys: new Set() })
    const fullPrompt = full.parse.mock.calls[0][0].messages[0].content as string
    expect(fullPrompt).toContain('Review the whole vault.')
    expect(fullPrompt).not.toContain('FOCUS |')
  })

  it('verifies candidates in batches of 5 and reports progress per batch', async () => {
    const people = Array.from({ length: 8 }, (_, i) => parseNote(`people/P${i}.md`, `Person ${i}`))
    const candidates = people.slice(1).map(p => ({ kind: 'relation', a: people[0].path, b: p.path }))
    const accept = (n: number) => ({ decisions: Array.from({ length: n }, (_, i) => ({
      candidate: i + 1, accept: true, source: people[0].path, target: candidates[i + (n === 5 ? 0 : 5)].b,
      relationType: 'works_with', reason: 'r', confidence: 0.9,
    })) })
    const { client, parse } = fakeAnthropic({ candidates }, accept(5), accept(2))
    const events: unknown[] = []

    const drafts = await generateSuggestions(
      client, { notes: people, focusPaths: null, blockedKeys: new Set() }, e => events.push(e),
    )

    expect(parse).toHaveBeenCalledTimes(3) // 1 scan + 2 verify batches
    expect(drafts).toHaveLength(7)
    expect(events).toEqual([
      { phase: 'scanning', notes: 8 },
      { phase: 'verifying', done: 0, total: 7 },
      { phase: 'verifying', done: 5, total: 7 },
      { phase: 'verifying', done: 7, total: 7 },
    ])
    // Each batch is numbered from 1 and only contains its own candidates
    const batch2 = parse.mock.calls[2][0].messages[0].content as string
    expect(batch2).toContain(`1. relation: ${people[0].path} ↔ ${people[6].path}`)
    expect(batch2).not.toContain(people[1].path)
  })

  it('does not call Claude when nothing changed', async () => {
    const { client, parse } = fakeAnthropic()
    expect(await generateSuggestions(client, { notes, focusPaths: new Set(), blockedKeys: new Set() })).toEqual([])
    expect(parse).not.toHaveBeenCalled()
  })

  it('throws when Claude declines', async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'refusal', parsed_output: null })
    const client = { messages: { parse } } as unknown as Anthropic
    await expect(generateSuggestions(client, { notes, focusPaths: null, blockedKeys: new Set() })).rejects.toThrow('declined')
  })
})

describe('runSuggestionReview', () => {
  function memoryVault(files: Record<string, string>) {
    const shas: Record<string, string> = {}
    let version = 0
    const client: VaultClient = {
      getMarkdownTree: async () => Object.keys(files).filter(p => p.endsWith('.md')).map(path => ({ path, sha: shas[path] ?? `sha-${path}` })),
      getSystemFiles: async () => [],
      readFile: async path => {
        if (!(path in files)) throw new Error(`Failed to read file ${path}: 404`)
        return { content: files[path], sha: shas[path] ?? `sha-${path}` }
      },
      writeFile: async (path, content) => { files[path] = content; shas[path] = `v${++version}` },
      deleteFile: async path => { delete files[path] },
    }
    return { client, files, shas }
  }

  const raw = {
    [jan.path]: '---\ntype: person\n---\nJan works on [[Superbrain]].',
    [superbrain.path]: '---\ntype: project\n---\nKnowledge graph app.',
    [idea.path]: '---\ntype: idea\n---\nSearch the graph.',
  }

  it('stores suggestions and only re-reviews changed notes next time', async () => {
    const vault = memoryVault({ ...raw })
    const first = fakeAnthropic(
      { candidates: [{ kind: 'relation', a: idea.path, b: superbrain.path }] },
      { decisions: [{ candidate: 1, accept: true, source: idea.path, target: superbrain.path, relationType: 'part_of', reason: 'Feature', confidence: 0.8 }] },
    )
    const events: { phase: string }[] = []
    const result = await runSuggestionReview(vault.client, first.client, { onProgress: e => events.push(e) })
    expect(result).toMatchObject({ reviewedNotes: 3, focusNotes: 3, added: 1, pending: 1 })
    expect(events[0]).toEqual({ phase: 'reading', done: 0, total: 3 })
    expect(events.map(e => e.phase)).toEqual(['reading', 'reading', 'scanning', 'verifying', 'verifying', 'saving'])

    const stored = JSON.parse(vault.files[SUGGESTIONS_PATH])
    expect(stored.suggestions[0]).toMatchObject({ kind: 'relation', source: idea.path, target: superbrain.path, relationType: 'part_of', status: 'pending' })
    expect(Object.keys(stored.seen)).toHaveLength(3)

    // Nothing changed → no focus notes → Claude is not called
    const second = fakeAnthropic()
    const again = await runSuggestionReview(vault.client, second.client)
    expect(again).toMatchObject({ focusNotes: 0, added: 0, pending: 1 })
    expect(second.parse).not.toHaveBeenCalled()

    // A full scan reviews everything, but the open pair is not suggested twice
    const full = fakeAnthropic({ candidates: [{ kind: 'relation', a: superbrain.path, b: idea.path }] })
    const scanned = await runSuggestionReview(vault.client, full.client, { fullScan: true })
    expect(scanned).toMatchObject({ focusNotes: 3, added: 0, pending: 1 })
    expect(full.parse).toHaveBeenCalledTimes(1)
  })
})

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const results = await mapWithConcurrency([30, 10, 20, 0, 5], 2, async ms => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, ms))
      inFlight--
      return ms * 2
    })
    expect(results).toEqual([60, 20, 40, 0, 10])
    expect(maxInFlight).toBe(2)
  })
})
