import { describe, it, expect } from 'vitest'
import {
  buildStacks, placeStacks, displacePiles, fanPositions, fanBounds, pileOffset, excerpt,
  LOOSE_STACK, OTHER_STACK, CARD_W, CARD_H, type TableNode, type TableEdge,
} from '../table-layout'

const n = (id: string, type: string): TableNode => ({ id, title: id, type })
const e = (source: string, target: string, relationType?: string): TableEdge => ({ source, target, relationType })

const nodes = [
  n('me', 'person'),
  n('ddz', 'organisation'), n('meet1', 'meeting'), n('meet2', 'meeting'), n('meet3', 'meeting'),
  n('prop', 'project'), n('tpl', 'resource'), n('idea', 'idea'), n('client', 'person'),
  n('sanne', 'person'),
  n('pair-a', 'note'), n('pair-b', 'note'),
  n('alone', 'idea'),
]
const edges = [
  e('me', 'ddz', 'works_with'), e('me', 'prop', 'works_with'),
  e('meet1', 'ddz'), e('meet2', 'ddz'), e('meet3', 'ddz'),
  e('tpl', 'prop', 'part_of'), e('idea', 'prop'), e('client', 'prop'),
  e('idea', 'ddz', 'part_of'),
  e('sanne', 'meet1'),
  e('pair-a', 'pair-b'),
]

describe('buildStacks', () => {
  const stacks = buildStacks(nodes, edges, 'me')
  const byId = new Map(stacks.map(s => [s.id, s]))

  it('makes a pile per hub with enough references, hub first', () => {
    expect(byId.get('stack:ddz')?.members[0]).toBe('ddz')
    expect(byId.get('stack:prop')?.members[0]).toBe('prop')
  })

  it('puts a card on the hub it is most strongly tied to', () => {
    // idea links plainly to prop but has a typed part_of to ddz: the typed relation wins
    expect(byId.get('stack:ddz')?.members).toContain('idea')
    expect(byId.get('stack:prop')?.members).not.toContain('idea')
    expect(byId.get('stack:prop')?.members).toEqual(expect.arrayContaining(['tpl', 'client']))
  })

  it('lets a card two steps away join its neighbour’s pile', () => {
    expect(byId.get('stack:ddz')?.members).toContain('sanne')
  })

  it('keeps the owner off the piles and sorts the rest into Other and No references', () => {
    expect(stacks.flatMap(s => s.members)).not.toContain('me')
    expect(byId.get(OTHER_STACK)?.members).toEqual(['pair-a', 'pair-b'])
    expect(byId.get(LOOSE_STACK)?.members).toEqual(['alone'])
  })

  it('places every card except the owner exactly once', () => {
    const all = stacks.flatMap(s => s.members)
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBe(nodes.length - 1)
  })

  it('does not make a hub of a card type that is not a hub type', () => {
    const many = [n('p', 'person'), n('a', 'note'), n('b', 'note'), n('c', 'note')]
    const s = buildStacks(many, [e('a', 'p'), e('b', 'p'), e('c', 'p')])
    expect(s.map(x => x.id)).toEqual([OTHER_STACK])
  })
})

describe('placement', () => {
  it('gives each pile its own slot, the biggest nearest the middle and the loose pile last', () => {
    const stacks = buildStacks(nodes, edges, 'me')
    const pos = placeStacks(stacks)
    expect(pos.size).toBe(stacks.length)
    const keys = [...pos.values()].map(p => `${p.x},${p.y}`)
    expect(new Set(keys).size).toBe(keys.length)
    const dist = (id: string) => Math.hypot(pos.get(id)!.x, pos.get(id)!.y)
    expect(dist('stack:ddz')).toBeLessThanOrEqual(dist(LOOSE_STACK))
    expect([...pos.values()].every(p => p.x !== 0 || p.y !== 0)).toBe(true) // the centre is the owner's
  })

  it('fans cards into a centred grid that matches its bounds', () => {
    const pts = fanPositions(10, { x: 100, y: 50 })
    expect(pts).toHaveLength(10)
    const xs = pts.map(p => p.x)
    const { w } = fanBounds(10)
    expect(Math.max(...xs) - Math.min(...xs) + CARD_W).toBeCloseTo(w)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(100)
  })

  it('gives each card a stable pile offset', () => {
    expect(pileOffset('a', 2)).toEqual(pileOffset('a', 2))
    expect(pileOffset('a', 2)).not.toEqual(pileOffset('b', 2))
  })
})

describe('displacePiles', () => {
  const centres = new Map([
    ['a', { x: 0, y: 0 }], ['right', { x: 520, y: 0 }], ['below', { x: 0, y: 390 }],
    ['diag', { x: -520, y: -390 }], ['far', { x: 1040, y: 0 }],
  ])

  it('leaves everything in place when no pile is open', () => {
    expect(displacePiles(centres, null, 0)).toBe(centres)
  })

  it('moves the neighbours clear of a large fan, keeping the grid', () => {
    const count = 40
    const out = displacePiles(centres, 'a', count)
    const fan = fanBounds(count)
    expect(out.get('a')).toEqual({ x: 0, y: 0 })
    expect(out.get('right')!.x - CARD_W / 2).toBeGreaterThan(fan.w / 2)
    expect(out.get('right')!.y).toBe(0)
    expect(out.get('below')!.y - CARD_H / 2).toBeGreaterThan(fan.h / 2)
    expect(out.get('below')!.x).toBe(0)
    expect(out.get('diag')!.x).toBeLessThan(-520)
    expect(out.get('diag')!.y).toBeLessThanOrEqual(-390)
    // Columns move together, so the gap between them stays the same
    expect(out.get('far')!.x - out.get('right')!.x).toBe(520)
  })

  it('does not move anything for a fan that already fits', () => {
    const out = displacePiles(centres, 'a', 2)
    expect(out.get('right')).toEqual({ x: 520, y: 0 })
  })
})

describe('excerpt', () => {
  it('strips markdown and wikilinks', () => {
    expect(excerpt('# Title\nWerkt aan [[Propositio]] en **DDZ**.')).toBe('Werkt aan Propositio en DDZ .')
  })
})
