// Layout of the "table": every card in the archive lies on one plane, piled up around its hub
// (an area, organisation or project that many cards refer to). Pure functions, so they can be tested.

export interface TableNode { id: string; title: string; type: string }
export interface TableEdge { source: string; target: string; relationType?: string }

export interface Stack {
  id: string
  title: string
  /** The hub card itself; null for the "Other" and "No references" piles */
  hubId: string | null
  /** Card ids, the hub first */
  members: string[]
}

export interface Point { x: number; y: number }

/** Note types whose cards can carry a pile of their own */
export const HUB_TYPES = new Set(['area', 'organisation', 'organization', 'company', 'project', 'group'])
/** A hub needs at least this many references before it becomes a pile */
export const MIN_HUB_REFERENCES = 3

export const OTHER_STACK = 'stack:other'
export const LOOSE_STACK = 'stack:loose'

export const CARD_W = 184
export const CARD_H = 72
const FAN_GAP_X = 16
const FAN_GAP_Y = 14
export const STACK_SPACING = 520
export const ROW_SPACING = STACK_SPACING * 0.75
/** Room kept free around a fanned pile, for its header and the pile labels next to it */
const FAN_MARGIN = 90

function neighbourMap(nodes: TableNode[], edges: TableEdge[]) {
  const ids = new Set(nodes.map(n => n.id))
  const map = new Map<string, { id: string; typed: boolean }[]>()
  for (const n of nodes) map.set(n.id, [])
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue
    map.get(e.source)!.push({ id: e.target, typed: !!e.relationType })
    map.get(e.target)!.push({ id: e.source, typed: !!e.relationType })
  }
  return map
}

/**
 * Puts every card on one pile. Hubs (cards of a hub type with enough references) each get a pile;
 * a card lies on the hub it is most strongly tied to: a typed relation beats a plain link, then the
 * busier hub wins. Cards without a hub nearby go on "Other", cards without any link on "No references".
 * The owner's own card stays off the piles: it lies in the middle of the table.
 */
export function buildStacks(nodes: TableNode[], edges: TableEdge[], ownerId: string | null = null): Stack[] {
  const neighbours = neighbourMap(nodes, edges)
  const degree = (id: string) => neighbours.get(id)?.length ?? 0
  const byId = new Map(nodes.map(n => [n.id, n]))

  const hubs = nodes
    .filter(n => n.id !== ownerId && HUB_TYPES.has(n.type.toLowerCase()) && degree(n.id) >= MIN_HUB_REFERENCES)
    .sort((a, b) => degree(b.id) - degree(a.id) || a.title.localeCompare(b.title))
  const hubIds = new Set(hubs.map(h => h.id))

  const pick = (id: string): string | null => {
    let best: { hub: string; score: number } | null = null
    for (const nb of neighbours.get(id) ?? []) {
      if (!hubIds.has(nb.id)) continue
      const score = (nb.typed ? 10_000 : 0) + degree(nb.id)
      if (!best || score > best.score) best = { hub: nb.id, score }
    }
    return best?.hub ?? null
  }

  const members = new Map<string, string[]>(hubs.map(h => [h.id, [h.id]]))
  const other: string[] = []
  const loose: string[] = []
  const pending: string[] = []

  for (const n of nodes) {
    if (n.id === ownerId || hubIds.has(n.id)) continue
    const hub = pick(n.id)
    if (hub) members.get(hub)!.push(n.id)
    else pending.push(n.id)
  }
  // Second pass: a card two steps from a hub joins the pile of a neighbour that found one
  const assigned = new Map<string, string>()
  for (const [hub, list] of members) for (const id of list) assigned.set(id, hub)
  for (const id of pending) {
    if (degree(id) === 0) { loose.push(id); continue }
    const viaNeighbour = (neighbours.get(id) ?? []).map(nb => assigned.get(nb.id)).find(Boolean)
    if (viaNeighbour) members.get(viaNeighbour)!.push(id)
    else other.push(id)
  }

  const byTitle = (a: string, b: string) => (byId.get(a)?.title ?? '').localeCompare(byId.get(b)?.title ?? '')
  const stacks: Stack[] = hubs.map(h => ({
    id: `stack:${h.id}`,
    title: h.title,
    hubId: h.id,
    members: [h.id, ...members.get(h.id)!.slice(1).sort(byTitle)],
  }))
  if (other.length) stacks.push({ id: OTHER_STACK, title: 'Other', hubId: null, members: other.sort(byTitle) })
  if (loose.length) stacks.push({ id: LOOSE_STACK, title: 'No references', hubId: null, members: loose.sort(byTitle) })
  return stacks
}

/** Pile positions on the table: the biggest piles nearest the middle, where the owner's card lies. */
export function placeStacks(stacks: Stack[]): Map<string, Point> {
  const slots: Point[] = []
  // A square spiral of slots around the centre, nearest first; the centre itself is the owner's
  for (let ring = 1; slots.length < stacks.length; ring++) {
    for (let gx = -ring; gx <= ring; gx++) {
      for (let gy = -ring; gy <= ring; gy++) {
        if (Math.max(Math.abs(gx), Math.abs(gy)) === ring) slots.push({ x: gx * STACK_SPACING, y: gy * ROW_SPACING })
      }
    }
  }
  slots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
  const order = [...stacks].sort((a, b) => {
    // The loose pile goes to the edge, the rest by size
    if (a.id === LOOSE_STACK) return 1
    if (b.id === LOOSE_STACK) return -1
    return b.members.length - a.members.length
  })
  return new Map(order.map((s, i) => [s.id, slots[i]]))
}

/** Small deterministic offsets so a pile looks like a pile, not a tower. */
export function pileOffset(id: string, index: number): { x: number; y: number; rotate: number } {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const r = (shift: number) => (((h >>> shift) & 0xff) / 255 - 0.5)
  const depth = Math.min(index, 6)
  return { x: r(0) * 14 + depth * 2, y: r(8) * 10 - depth * 2, rotate: r(16) * 10 }
}

/** Card positions when a pile is fanned out: a grid of readable cards centred on the pile. */
export function fanPositions(count: number, center: Point): Point[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.8)))
  const rows = Math.ceil(count / cols)
  const width = cols * CARD_W + (cols - 1) * FAN_GAP_X
  const height = rows * CARD_H + (rows - 1) * FAN_GAP_Y
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      x: center.x - width / 2 + col * (CARD_W + FAN_GAP_X) + CARD_W / 2,
      y: center.y - height / 2 + row * (CARD_H + FAN_GAP_Y) + CARD_H / 2,
    }
  })
}

/** Bounding box of a fanned pile, for flying the camera to it. */
export function fanBounds(count: number): { w: number; h: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.8)))
  const rows = Math.ceil(count / cols)
  return { w: cols * CARD_W + (cols - 1) * FAN_GAP_X, h: rows * CARD_H + (rows - 1) * FAN_GAP_Y }
}

/**
 * Makes room for a fanned pile: the grid of piles is stretched around it, so the columns beside
 * it and the rows above and below it move out just far enough. Piles keep their order and never
 * land on each other.
 */
export function displacePiles(centres: Map<string, Point>, openId: string | null, count: number): Map<string, Point> {
  const o = openId ? centres.get(openId) : undefined
  if (!o) return centres
  const b = fanBounds(count)
  const extraX = Math.max(0, b.w / 2 + CARD_W / 2 + FAN_MARGIN - STACK_SPACING)
  const extraY = Math.max(0, b.h / 2 + CARD_H / 2 + FAN_MARGIN * 1.5 - ROW_SPACING)
  const out = new Map<string, Point>()
  for (const [id, p] of centres) {
    const dx = p.x - o.x
    const dy = p.y - o.y
    out.set(id, {
      x: p.x + (Math.abs(dx) < 1 ? 0 : Math.sign(dx) * extraX),
      y: p.y + (Math.abs(dy) < 1 ? 0 : Math.sign(dy) * extraY),
    })
  }
  return out
}

/** Plain-text excerpt of a note body for a card face. */
export function excerpt(markdown: string, max = 140): string {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s.*$/gm, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, target: string, alias: string) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}
