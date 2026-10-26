import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { parseNote } from '../vault-parser'
import { areLinked, detachedGroups, pairKey, pruneSuggestions, unconnectedPaths, visibleSuggestions, SUGGESTIONS_PATH, type Suggestion } from '../suggestions'
import { generateSuggestions, matchOrphans, MIN_CONFIDENCE } from '../suggestion-engine'
import { fileSuggestion, runSuggestionReview } from '../suggestion-review'
import { PREFERENCES_PATH } from '../vault-preferences'
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

    const { drafts, rejected } = await generateSuggestions(client, {
      notes, focusPaths: new Set([janDup.path, idea.path]), blockedKeys: new Set(),
    })

    expect(drafts).toEqual([
      { kind: 'merge', source: janDup.path, target: jan.path, reason: 'Same person', confidence: 0.9 },
    ])
    // The low-confidence candidate is kept as a rejection with Claude's reason
    expect(rejected).toEqual([{ kind: 'relation', a: idea.path, b: superbrain.path, reason: 'Feature idea' }])
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

    const { drafts } = await generateSuggestions(client, {
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
    const { drafts } = await generateSuggestions(client, { notes, focusPaths: null, blockedKeys: new Set() })
    expect(drafts).toEqual([])
  })

  it('marks FOCUS notes for incremental runs but not for a full scan', async () => {
    const incremental = fakeAnthropic({ candidates: [] })
    await generateSuggestions(incremental.client, { notes, focusPaths: new Set([idea.path]), blockedKeys: new Set() })
    const prompt = incremental.parse.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain(`FOCUS | ${idea.path}`)
    expect(prompt).toContain('Every candidate must involve at least one FOCUS note')
    // Linked notes can still be duplicates: only relations skip already-linked pairs
    expect(prompt).toContain('for merges, a link between the two notes is no reason to skip them')

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

    const { drafts } = await generateSuggestions(
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
    expect(await generateSuggestions(client, { notes, focusPaths: new Set(), blockedKeys: new Set() }))
      .toEqual({ drafts: [], rejected: [], scanned: false })
    expect(parse).not.toHaveBeenCalled()
  })

  it('throws when Claude declines', async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: 'refusal', parsed_output: null })
    const client = { messages: { parse } } as unknown as Anthropic
    await expect(generateSuggestions(client, { notes, focusPaths: null, blockedKeys: new Set() })).rejects.toThrow('declined')
  })
})

describe('runSuggestionReview', () => {

  const raw = {
    [jan.path]: '---\ntype: person\n---\nJan works on [[Superbrain]].',
    [superbrain.path]: '---\ntype: project\n---\nKnowledge graph app.',
    [idea.path]: '---\ntype: idea\n---\nSearch the graph.',
  }

  it('stores suggestions and only re-reviews changed notes next time', async () => {
    const vault = memoryVault({ ...raw })
    const first = fakeAnthropic(
      { candidates: [
        { kind: 'relation', a: idea.path, b: superbrain.path },
        { kind: 'merge', a: idea.path, b: superbrain.path },
      ] },
      { decisions: [
        { candidate: 1, accept: true, source: idea.path, target: superbrain.path, relationType: 'part_of', reason: 'Feature', confidence: 0.8 },
        { candidate: 2, accept: false, source: idea.path, target: superbrain.path, relationType: 'none', reason: 'Een idee binnen het project, geen dubbel', confidence: 0.1 },
      ] },
    )
    const events: { phase: string }[] = []
    const result = await runSuggestionReview(vault.client, first.client, { onProgress: e => events.push(e) })
    expect(result).toMatchObject({ reviewedNotes: 3, focusNotes: 3, added: 1, pending: 1 })
    expect(events[0]).toEqual({ phase: 'reading', done: 0, total: 3 })
    expect(events.map(e => e.phase)).toEqual(['reading', 'reading', 'scanning', 'verifying', 'verifying', 'saving'])

    const stored = JSON.parse(vault.files[SUGGESTIONS_PATH])
    expect(stored.suggestions[0]).toMatchObject({ kind: 'relation', source: idea.path, target: superbrain.path, relationType: 'part_of', status: 'pending' })
    expect(Object.keys(stored.seen)).toHaveLength(3)
    expect(stored.rejected).toEqual([{ kind: 'merge', a: idea.path, b: superbrain.path, reason: 'Een idee binnen het project, geen dubbel' }])

    // Nothing changed → no focus notes → Claude is not called
    const second = fakeAnthropic()
    const again = await runSuggestionReview(vault.client, second.client)
    expect(again).toMatchObject({ focusNotes: 0, added: 0, pending: 1 })
    expect(second.parse).not.toHaveBeenCalled()
    expect(JSON.parse(vault.files[SUGGESTIONS_PATH]).rejected).toHaveLength(1) // kept: nothing was scanned

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

describe('unconnected notes', () => {
  const me = parseNote('people/Milan.md', '---\ntype: person\n---\nWorks on [[DDZ]].')
  const ddz = parseNote('companies/DDZ.md', '---\ntype: company\n---\nDigital District Zwolle.')
  const lonely = parseNote('notes/Meetup idea.md', '---\ntype: idea\n---\nTech meetup at DDZ.')
  const random = parseNote('notes/Recipe.md', '---\ntype: note\n---\nPancakes.')

  it('unconnectedPaths finds notes without links in either direction', () => {
    const nodes = [me, ddz, lonely].map(n => ({ id: n.path, path: n.path }))
    expect([...unconnectedPaths(nodes, [{ source: me.path, target: ddz.path }])]).toEqual([lonely.path])
  })

  it('detachedGroups finds single notes and islands no path connects to the owner', () => {
    const ids = ['me', 'ddz', 'a', 'b', 'c', 'lonely']
    const nodes = ids.map(id => ({ id, path: id }))
    const edges = [
      { source: 'me', target: 'ddz' },
      { source: 'a', target: 'b' }, { source: 'c', target: 'b' },
    ]
    // The island's best-connected note comes first
    expect(detachedGroups(nodes, edges, 'me')).toEqual([['b', 'a', 'c'], ['lonely']])
    expect(detachedGroups(nodes, [...edges, { source: 'c', target: 'ddz' }], 'me')).toEqual([['lonely']])
  })

  it('matchOrphans asks for one link per island, from whichever of its notes fits best', async () => {
    const hub = parseNote('notes/Meetup series.md', '---\ntype: project\n---\nSeries. [[Meetup idea]]')
    const { client, parse } = fakeAnthropic({ matches: [
      { orphan: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 },
      { orphan: hub.path, target: me.path, relationType: 'works_with', reason: 'second link for the same island', confidence: 0.9 },
    ] })
    const result = await matchOrphans(client, { groups: [[hub, lonely], [random]], network: [me, ddz], blockedKeys: new Set() })

    expect(result.drafts).toEqual([
      { kind: 'relation', source: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 },
    ])
    // A group without a match is reported by its best-connected note
    expect(result.unmatched).toEqual([random.path])
    const prompt = parse.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('<group id="1">')
    expect(prompt).toContain(`path=${JSON.stringify(lonely.path)}`)
  })

  it('matchOrphans links good fits and reports the rest as unmatched', async () => {
    const { client, parse } = fakeAnthropic({ matches: [
      { orphan: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 },
      { orphan: random.path, target: 'none', relationType: 'none', reason: 'Geen match', confidence: 0 },
    ] })
    const events: unknown[] = []
    const result = await matchOrphans(client, { groups: [[lonely], [random]], network: [me, ddz], blockedKeys: new Set() }, e => events.push(e))

    expect(result.drafts).toEqual([
      { kind: 'relation', source: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 },
    ])
    expect(result.unmatched).toEqual([random.path])
    expect(events).toEqual([{ phase: 'orphans', done: 0, total: 2 }, { phase: 'orphans', done: 2, total: 2 }])
    const prompt = parse.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain(`- | ${ddz.path}`)
    expect(prompt).toContain('target "none"')
  })

  it('matchOrphans never suggests a pair the owner declined, and says so in the prompt', async () => {
    const blocked = new Set([pairKey('relation', lonely.path, ddz.path)])
    const { client, parse } = fakeAnthropic({ matches: [
      { orphan: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'r', confidence: 0.9 },
    ] })
    const result = await matchOrphans(client, { groups: [[lonely]], network: [me, ddz], blockedKeys: blocked })
    expect(result.drafts).toEqual([])
    expect(result.unmatched).toEqual([lonely.path])
    expect(parse.mock.calls[0][0].messages[0].content).toContain(`${lonely.path}: do not suggest ${ddz.path}`)
  })

  it('a run also offers a link for an island of notes that only link to each other', async () => {
    const vault = memoryVault({
      [me.path]: '---\ntype: person\n---\nWorks on [[DDZ]].',
      [ddz.path]: '---\ntype: company\n---\nDigital District Zwolle.',
      'notes/Meetup series.md': '---\ntype: project\n---\nSeries. [[Meetup idea]]',
      [lonely.path]: '---\ntype: idea\n---\nTech meetup at DDZ.',
      [PREFERENCES_PATH]: JSON.stringify({ ownerNote: me.path }),
    })
    const { client, parse } = fakeAnthropic(
      { candidates: [] },
      { matches: [{ orphan: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 }] },
    )
    const result = await runSuggestionReview(vault.client, client)
    expect(result).toMatchObject({ added: 1, unlinked: 0 })
    const prompt = parse.mock.calls[1][0].messages[0].content as string
    expect(prompt.match(/<group id=/g)).toHaveLength(1)
    expect(prompt).toContain('notes/Meetup series.md')
  })

  it('a run with an owner note checks unconnected notes and stores the unmatched ones', async () => {
    const vault = memoryVault({
      [me.path]: '---\ntype: person\n---\nWorks on [[DDZ]].',
      [ddz.path]: '---\ntype: company\n---\nDigital District Zwolle.',
      [lonely.path]: '---\ntype: idea\n---\nTech meetup at DDZ.',
      [random.path]: '---\ntype: note\n---\nPancakes.',
      [PREFERENCES_PATH]: JSON.stringify({ ownerNote: me.path }),
    })
    const { client, parse } = fakeAnthropic(
      { candidates: [] },
      { matches: [
        { orphan: lonely.path, target: ddz.path, relationType: 'part_of', reason: 'Meetup bij DDZ', confidence: 0.85 },
        { orphan: random.path, target: 'none', relationType: 'none', reason: '-', confidence: 0 },
      ] },
    )
    const result = await runSuggestionReview(vault.client, client)
    expect(result).toMatchObject({ added: 1, unlinked: 1, ownerNoteSet: true })

    // The network sent to Claude is the owner plus direct neighbours only
    const orphanPrompt = parse.mock.calls[1][0].messages[0].content as string
    const network = orphanPrompt.slice(orphanPrompt.indexOf('<network>'), orphanPrompt.indexOf('</network>'))
    expect(network).toContain(me.path)
    expect(network).toContain(ddz.path)
    expect(network).not.toContain(random.path)

    const stored = JSON.parse(vault.files[SUGGESTIONS_PATH])
    expect(stored.unlinked).toEqual([random.path])

    // Next incremental run: nothing changed, the unmatched note is carried over without asking again
    const next = fakeAnthropic()
    const again = await runSuggestionReview(vault.client, next.client)
    expect(again).toMatchObject({ added: 0, unlinked: 1 })
    expect(next.parse).not.toHaveBeenCalled()
  })
})

describe('fileSuggestion (MCP)', () => {
  const files = {
    [jan.path]: '---\ntype: person\n---\nJan works on [[Superbrain]].',
    [superbrain.path]: '---\ntype: project\n---\nKnowledge graph app.',
    [idea.path]: '---\ntype: idea\n---\nSearch the graph.',
  }

  it('adds a chat suggestion to the Inbox store', async () => {
    const vault = memoryVault({ ...files })
    const result = await fileSuggestion(vault.client, {
      kind: 'relation', source: idea.path, target: superbrain.path, relationType: 'part_of', reason: 'Feature van Superbrain',
    })
    expect(result.status).toBe('added')
    const stored = JSON.parse(vault.files[SUGGESTIONS_PATH])
    expect(stored.suggestions[0]).toMatchObject({ origin: 'chat', status: 'pending', source: idea.path })
  })

  it('refuses unknown notes, already linked pairs and duplicates', async () => {
    const vault = memoryVault({ ...files })
    expect((await fileSuggestion(vault.client, { kind: 'merge', source: 'x.md', target: jan.path, reason: 'r' })).status).toBe('not_found')
    expect((await fileSuggestion(vault.client, {
      kind: 'relation', source: jan.path, target: superbrain.path, relationType: 'works_with', reason: 'r',
    })).status).toBe('already_linked')
    await fileSuggestion(vault.client, { kind: 'merge', source: idea.path, target: superbrain.path, reason: 'r' })
    expect((await fileSuggestion(vault.client, { kind: 'merge', source: superbrain.path, target: idea.path, reason: 'r' })).status).toBe('already_pending')
  })

  it('re-opens a pair that was dismissed before', async () => {
    const vault = memoryVault({ ...files })
    await fileSuggestion(vault.client, { kind: 'merge', source: idea.path, target: superbrain.path, reason: 'old' })
    const stored = JSON.parse(vault.files[SUGGESTIONS_PATH])
    stored.suggestions[0].status = 'dismissed'
    vault.files[SUGGESTIONS_PATH] = JSON.stringify(stored)

    const result = await fileSuggestion(vault.client, { kind: 'merge', source: idea.path, target: superbrain.path, reason: 'new' })
    expect(result.status).toBe('reopened')
    const after = JSON.parse(vault.files[SUGGESTIONS_PATH])
    expect(after.suggestions).toHaveLength(1)
    expect(after.suggestions[0]).toMatchObject({ status: 'pending', reason: 'new' })
  })
})
