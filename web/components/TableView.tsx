'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphEdge, GraphNode, VaultNote } from '@/lib/types'
import type { Suggestion } from '@/lib/suggestions'
import {
  buildStacks, placeStacks, displacePiles, pileOffset, fanPositions, fanBounds, excerpt,
  CARD_W, CARD_H, LOOSE_STACK, OTHER_STACK, type Point, type Stack,
} from '@/lib/table-layout'

// The table: every card of the archive lies on one plane, piled up around its hub.
// Zoom and drag to look around; a pile spreads out when you click it or zoom in on it.

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  notesByPath: Record<string, VaultNote>
  /** Your own note: it lies in the middle of the table */
  ownerId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  typeColors: Record<string, string>
  suggestions: Suggestion[]
}

const OWNER = 'owner'
const OWNER_W = 280
const OWNER_H = 168
const MIN_K = 0.12
const MAX_K = 2.5
/** Zoomed in this far, the pile nearest the middle of the screen spreads out by itself */
const AUTO_OPEN_K = 0.7
/** Cards visible in a pile; the rest lie hidden underneath */
const PILE_DEPTH = 6
const FLY_MS = 520

interface Placed { x: number; y: number; rotate: number; z: number; hidden: boolean; stackId: string; open: boolean }
interface Link { id: string; relation: string | null; suggestion?: Suggestion }
interface Camera { x: number; y: number; k: number }

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** The zoom at which a fanned pile fills the screen */
function fitZoom(count: number, size: { w: number; h: number }) {
  const b = fanBounds(count)
  return clampK(Math.min(1.1, (size.w * 0.88) / b.w, (size.h * 0.8) / (b.h + 70)))
}

export function TableView({ nodes, edges, notesByPath, ownerId, selectedId, onSelect, typeColors, suggestions }: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [openStack, setOpenStack] = useState<string | null>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const cam = useRef<Camera>({ x: 0, y: 0, k: 0.5 })
  const sizeRef = useRef({ w: 0, h: 0 })
  const anim = useRef<number | null>(null)
  const checkTimer = useRef<number | null>(null)
  const fitted = useRef(false)
  const trackpad = useRef(false)

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const owner = ownerId ? byId.get(ownerId) ?? null : null

  // ── Layout ────────────────────────────────────────────────────────────────
  const stacks = useMemo(() => buildStacks(nodes, edges, owner?.id ?? null), [nodes, edges, owner])
  const stackOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stacks) for (const id of s.members) m.set(id, s.id)
    return m
  }, [stacks])
  const slots = useMemo(() => {
    const m = new Map(placeStacks(stacks))
    if (owner) m.set(OWNER, { x: 0, y: 0 })
    return m
  }, [stacks, owner])
  const open = useMemo(() => stacks.find(s => s.id === openStack) ?? null, [stacks, openStack])
  const centres = useMemo(() => displacePiles(slots, open?.id ?? null, open?.members.length ?? 0), [slots, open])

  const placed = useMemo(() => {
    const m = new Map<string, Placed>()
    for (const s of stacks) {
      const c = centres.get(s.id)
      if (!c) continue
      if (s.id === open?.id) {
        fanPositions(s.members.length, c).forEach((p, i) => {
          m.set(s.members[i], { x: p.x, y: p.y, rotate: 0, z: 1000 + i, hidden: false, stackId: s.id, open: true })
        })
      } else {
        s.members.forEach((id, i) => {
          const o = pileOffset(id, i)
          m.set(id, {
            x: c.x + o.x, y: c.y + o.y, rotate: i === 0 ? o.rotate * 0.3 : o.rotate,
            z: 100 - Math.min(i, PILE_DEPTH), hidden: i > PILE_DEPTH, stackId: s.id, open: false,
          })
        })
      }
    }
    return m
  }, [stacks, centres, open])

  const posOf = useCallback((id: string): Point | null => {
    if (owner && id === owner.id) return centres.get(OWNER) ?? null
    return placed.get(id) ?? null
  }, [owner, centres, placed])

  // A card picked elsewhere (search, a reference in the panel) opens its pile
  const [prevSelected, setPrevSelected] = useState(selectedId)
  if (selectedId !== prevSelected) {
    setPrevSelected(selectedId)
    const st = selectedId ? stackOf.get(selectedId) : undefined
    if (st && st !== openStack) setOpenStack(st)
  }

  // References of the selected card, and the open suggestions it is part of
  const links = useMemo(() => {
    const m = new Map<string, Link>()
    if (!selectedId) return m
    for (const e of edges) {
      const other: string | null = e.source === selectedId ? e.target : e.target === selectedId ? e.source : null
      if (!other || other === selectedId || !byId.has(other)) continue
      const prev = m.get(other)
      if (!prev || (!prev.relation && e.relationType)) m.set(other, { id: other, relation: e.relationType ?? null })
    }
    for (const s of suggestions) {
      const other = s.source === selectedId ? s.target : s.target === selectedId ? s.source : null
      if (!other || !byId.has(other)) continue
      m.set(other, { id: other, relation: m.get(other)?.relation ?? null, suggestion: s })
    }
    return m
  }, [selectedId, edges, suggestions, byId])

  const flagged = useMemo(() => new Set(suggestions.flatMap(s => [s.source, s.target])), [suggestions])

  // ── Camera ────────────────────────────────────────────────────────────────
  // The camera lives outside React state: moving it only touches the world's transform
  const layoutRef = useRef({ stacks, centres, slots, open })
  useEffect(() => { layoutRef.current = { stacks, centres, slots, open } }, [stacks, centres, slots, open])

  const apply = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const { x, y, k } = cam.current
    world.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    world.style.setProperty('--k', String(k))
    world.dataset.zoom = k < 0.32 ? 'far' : 'near'
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(k * 100)}%`
  }, [])

  const stopFlight = useCallback(() => {
    if (anim.current !== null) cancelAnimationFrame(anim.current)
    anim.current = null
  }, [])

  // After the camera comes to rest: spread out the pile you zoomed in on, gather it when you zoom out
  const autoFan = useCallback(() => {
    if (anim.current !== null) return
    const { stacks, centres, open } = layoutRef.current
    const size = sizeRef.current
    const { x, y, k } = cam.current
    if (open && k < fitZoom(open.members.length, size) * 0.6) { setOpenStack(null); return }
    if (k < AUTO_OPEN_K) return
    const c = { x: (size.w / 2 - x) / k, y: (size.h / 2 - y) / k }
    let best: Stack | null = null
    let bestD = Infinity
    for (const s of stacks) {
      const p = centres.get(s.id)
      if (!p) continue
      let d: number
      if (s.id === open?.id) {
        const b = fanBounds(s.members.length)
        d = Math.hypot(Math.max(0, Math.abs(c.x - p.x) - b.w / 2), Math.max(0, Math.abs(c.y - p.y) - b.h / 2))
      } else {
        d = Math.hypot(c.x - p.x, c.y - p.y)
      }
      if (d < bestD) { best = s; bestD = d }
    }
    const own = centres.get(OWNER)
    if (own && Math.hypot(c.x - own.x, c.y - own.y) < bestD) return
    if (best && best.id !== open?.id && bestD * k < Math.min(size.w, size.h) * 0.4) setOpenStack(best.id)
  }, [])

  const scheduleCheck = useCallback(() => {
    if (checkTimer.current !== null) window.clearTimeout(checkTimer.current)
    checkTimer.current = window.setTimeout(autoFan, 220)
  }, [autoFan])

  const flyTo = useCallback((centre: Point, k: number, opts: { instant?: boolean; check?: boolean } = {}) => {
    stopFlight()
    const target = clampK(k)
    const from = { ...cam.current }
    const c0 = { x: (sizeRef.current.w / 2 - from.x) / from.k, y: (sizeRef.current.h / 2 - from.y) / from.k }
    // The size is read every frame: the detail panel may open while the camera is under way
    const set = (cx: number, cy: number, kk: number) => {
      const { w, h } = sizeRef.current
      cam.current = { x: w / 2 - cx * kk, y: h / 2 - cy * kk, k: kk }
      apply()
    }
    if (opts.instant) { set(centre.x, centre.y, target); return }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / FLY_MS)
      const e = ease(t)
      set(c0.x + (centre.x - c0.x) * e, c0.y + (centre.y - c0.y) * e, from.k * Math.pow(target / from.k, e))
      if (t < 1) { anim.current = requestAnimationFrame(step); return }
      anim.current = null
      if (opts.check) scheduleCheck()
    }
    anim.current = requestAnimationFrame(step)
  }, [apply, stopFlight, scheduleCheck])

  const fitAll = useCallback((instant = false) => {
    const { slots } = layoutRef.current
    const { w, h } = sizeRef.current
    if (!slots.size || !w) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [id, p] of slots) {
      const hw = id === OWNER ? OWNER_W / 2 : CARD_W / 2 + 20
      const hh = id === OWNER ? OWNER_H / 2 : CARD_H / 2 + 20
      minX = Math.min(minX, p.x - hw); maxX = Math.max(maxX, p.x + hw)
      minY = Math.min(minY, p.y - hh); maxY = Math.max(maxY, p.y + hh + 70)
    }
    const k = Math.min(1, (w * 0.9) / (maxX - minX), (h * 0.85) / (maxY - minY))
    flyTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, k, { instant })
  }, [flyTo])

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const { x, y, k } = cam.current
    const k2 = clampK(k * factor)
    cam.current = { x: px - (px - x) * (k2 / k), y: py - (py - y) * (k2 / k), k: k2 }
    apply()
    scheduleCheck()
  }, [apply, scheduleCheck])

  const openPile = useCallback((s: Stack) => {
    setOpenStack(s.id)
    const c = layoutRef.current.slots.get(s.id)
    if (c) flyTo(c, fitZoom(s.members.length, sizeRef.current))
  }, [flyTo])

  const closePiles = useCallback(() => {
    setOpenStack(null)
    fitAll()
  }, [fitAll])

  // Measure the table; the first time, show all piles
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const prev = sizeRef.current
      sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height }
      if (fitted.current && anim.current === null) {
        // Keep what was in the middle in the middle, e.g. when the detail panel opens
        cam.current = { ...cam.current, x: cam.current.x + (sizeRef.current.w - prev.w) / 2, y: cam.current.y + (sizeRef.current.h - prev.h) / 2 }
        apply()
      }
      if (!fitted.current && entry.contentRect.width > 0) {
        fitted.current = true
        fitAll(true)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, fitAll, apply])

  useEffect(() => () => {
    stopFlight()
    if (checkTimer.current !== null) window.clearTimeout(checkTimer.current)
  }, [stopFlight])

  // Wheel and trackpad: pinch (or ctrl + wheel) zooms; a mouse wheel zooms, a two-finger swipe pans
  useEffect(() => {
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      stopFlight()
      if (!e.ctrlKey && e.deltaX !== 0) trackpad.current = true
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      if (trackpad.current && !e.ctrlKey) {
        cam.current = { ...cam.current, x: cam.current.x - e.deltaX * unit, y: cam.current.y - e.deltaY * unit }
        apply()
        scheduleCheck()
        return
      }
      const r = el!.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el, apply, stopFlight, zoomAt, scheduleCheck])

  // Escape gathers the open pile again
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenStack(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fly to a selected card that is off screen (once its pile has spread out)
  const flownTo = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedId || flownTo.current === selectedId) return
    const p = posOf(selectedId)
    if (!p) return
    flownTo.current = selectedId
    const { w, h } = sizeRef.current
    const { x, y, k } = cam.current
    const sx = p.x * k + x
    const sy = p.y * k + y
    const onScreen = sx > 40 && sx < w - 40 && sy > 40 && sy < h - 40 && k >= 0.45
    if (!onScreen) flyTo(p, Math.max(k, 0.9))
  }, [selectedId, posOf, flyTo])
  useEffect(() => { if (!selectedId) flownTo.current = null }, [selectedId])

  // ── Dragging and pinching ─────────────────────────────────────────────────
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ start: Point; moved: boolean; pinch: { d: number; m: Point } | null }>({ start: { x: 0, y: 0 }, moved: false, pinch: null })

  function pinchState(): { d: number; m: Point } | null {
    const [a, b] = [...pointers.current.values()]
    if (!a || !b) return null
    return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top })
    stopFlight()
    if (pointers.current.size === 1) gesture.current = { start: { x: e.clientX, y: e.clientY }, moved: false, pinch: null }
    else gesture.current.pinch = pinchState()
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const r = e.currentTarget.getBoundingClientRect()
    const now = { x: e.clientX - r.left, y: e.clientY - r.top }
    const g = gesture.current
    if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 5) return
    if (!g.moved) {
      g.moved = true
      // Only now take the pointer, so a plain click still reaches the card underneath
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    pointers.current.set(e.pointerId, now)
    if (pointers.current.size >= 2) {
      const next = pinchState()
      if (next && g.pinch) {
        const { x, y, k } = cam.current
        const k2 = clampK(k * (next.d / g.pinch.d))
        const px = g.pinch.m.x
        const py = g.pinch.m.y
        cam.current = {
          x: px - (px - x) * (k2 / k) + (next.m.x - px),
          y: py - (py - y) * (k2 / k) + (next.m.y - py),
          k: k2,
        }
        apply()
      }
      g.pinch = next
      return
    }
    cam.current = { ...cam.current, x: cam.current.x + now.x - prev.x, y: cam.current.y + now.y - prev.y }
    apply()
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    gesture.current.pinch = pointers.current.size >= 2 ? pinchState() : null
    if (gesture.current.moved) scheduleCheck()
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  const selectedPos = selectedId ? posOf(selectedId) : null
  // Within a spread-out pile the references are only highlighted; lines go to cards elsewhere
  const selectedOpen = selectedId ? placed.get(selectedId)?.open ?? false : false
  const lines = [...links.values()].filter(l => !(selectedOpen && placed.get(l.id)?.open))
  const ownerPos = centres.get(OWNER)
  const ownerNote = owner ? notesByPath[owner.path] : null
  const loose = (id: string) => id === OTHER_STACK || id === LOOSE_STACK

  if (nodes.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-ink-muted">No cards on the table yet.</div>
  }

  return (
    <div
      ref={setEl}
      className="relative h-full w-full overflow-hidden touch-none select-none cursor-grab active:cursor-grabbing bg-paper"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={e => {
        // A drag that ends on a card is not a click on it
        if (gesture.current.moved) { e.stopPropagation(); e.preventDefault(); gesture.current.moved = false }
      }}
      onClick={e => {
        if (e.target === e.currentTarget || e.target === worldRef.current) onSelect(null)
      }}
    >
      <div ref={worldRef} data-zoom="near" className="group/table absolute left-0 top-0 origin-top-left" style={{ ['--k' as string]: 0.5 }}>
        {/* Your own card, in the middle */}
        {owner && ownerPos && (
          <button
            type="button"
            onClick={() => onSelect(owner.id)}
            className={`ruled absolute left-0 top-0 text-left rounded-[3px] border bg-index-card dark:bg-card px-5 overflow-hidden cursor-pointer shadow-[0_2px_10px_rgba(18,23,24,0.12)] transition-[transform,opacity,box-shadow] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
              selectedId === owner.id ? 'border-bookcloth ring-2 ring-bookcloth' : 'border-line-strong'
            }`}
            style={{
              width: OWNER_W, height: OWNER_H, zIndex: selectedId === owner.id ? 3000 : 90,
              transform: `translate(${ownerPos.x - OWNER_W / 2}px, ${ownerPos.y - OWNER_H / 2}px)`,
              borderTop: '3px solid var(--color-index-red)',
              fontSize: 16,
              lineHeight: '24px',
            }}
          >
            <span className="block font-mono text-[11px] leading-[24px] tracking-[0.08em] text-catalog-red">YOU</span>
            <span className="block font-serif text-xl font-medium text-ink leading-[24px] truncate">{owner.title}</span>
            {ownerNote && (
              <span className="block text-[13px] leading-[24px] text-ink-muted line-clamp-4 group-data-[zoom=far]/table:invisible">
                {excerpt(ownerNote.content, 180)}
              </span>
            )}
          </button>
        )}

        {/* Pile labels, kept readable when zoomed out */}
        {stacks.map(s => {
          const c = centres.get(s.id)
          if (!c || s.id === open?.id) return null
          return (
            <button
              key={`label:${s.id}`}
              type="button"
              tabIndex={-1}
              onClick={() => openPile(s)}
              className={`absolute left-0 top-0 whitespace-nowrap cursor-pointer flex items-baseline gap-1.5 px-2 py-0.5 rounded-[3px] transition-[left,top,opacity] duration-500 ${
                loose(s.id) ? 'border border-dashed border-line-strong text-ink-muted' : 'text-ink'
              } ${open ? 'text-ink-muted' : ''}`}
              style={{
                left: c.x, top: c.y + CARD_H / 2 + 16, zIndex: 95,
                transform: 'translateX(-50%) scale(clamp(1, calc(0.8 / var(--k)), 3))',
                transformOrigin: '50% 0',
              }}
            >
              <span className="font-serif text-[15px] font-medium max-w-[220px] truncate">{s.title}</span>
              <span className="font-mono text-[12px] text-ink-muted">{s.members.length}</span>
            </button>
          )
        })}

        {/* Header above a pile that is spread out */}
        {open && centres.get(open.id) && (() => {
          const c = centres.get(open.id)!
          const b = fanBounds(open.members.length)
          return (
            <div
              className="absolute left-0 top-0 flex items-center gap-3 whitespace-nowrap"
              style={{ left: c.x - b.w / 2, top: c.y - b.h / 2 - 14, transform: 'translateY(-100%)', zIndex: 1500 }}
            >
              <span className="font-serif text-2xl font-medium text-ink">{open.title}</span>
              <span className="font-mono text-sm text-ink-muted">{open.members.length} cards</span>
              <button
                type="button"
                onClick={() => setOpenStack(null)}
                className="h-7 px-2.5 text-xs rounded-[3px] border border-line-strong bg-card text-ink cursor-pointer hover:bg-paper"
              >
                Gather
              </button>
            </div>
          )
        })()}

        {/* Lines from the selected card to its references; dashed red for open suggestions */}
        {selectedPos && lines.length > 0 && (
          <svg
            key={`${openStack}:${selectedId}`}
            className="table-fade absolute left-0 top-0 overflow-visible pointer-events-none"
            width="1"
            height="1"
            style={{ zIndex: 900 }}
          >
            {lines.map(l => {
              const p = posOf(l.id)
              if (!p) return null
              return (
                <line
                  key={l.id}
                  x1={selectedPos.x} y1={selectedPos.y} x2={p.x} y2={p.y}
                  stroke={l.suggestion ? 'var(--color-catalog-red)' : 'var(--color-ruling-blue)'}
                  strokeWidth={l.relation || l.suggestion ? 2 : 1.25}
                  strokeDasharray={l.suggestion ? '6 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.85}
                />
              )
            })}
          </svg>
        )}
        {selectedPos && lines.filter(l => l.relation || l.suggestion).map(l => {
          const p = posOf(l.id)
          if (!p) return null
          return (
            <span
              key={`rel:${l.id}`}
              className={`table-fade absolute left-0 top-0 font-mono text-[11px] px-1.5 rounded-[2px] bg-paper whitespace-nowrap pointer-events-none ${l.suggestion ? 'text-catalog-red' : 'text-ruling-blue'}`}
              style={{
                left: (selectedPos.x + p.x) / 2, top: (selectedPos.y + p.y) / 2, zIndex: 950,
                transform: 'translate(-50%, -50%) scale(clamp(1, calc(1 / var(--k)), 2.5))',
              }}
            >
              {l.suggestion ? (l.suggestion.kind === 'merge' ? 'merge?' : `${l.suggestion.relationType ?? 'link'}?`) : l.relation}
            </span>
          )
        })}

        {/* The cards */}
        {nodes.map(n => {
          const p = placed.get(n.id)
          if (!p) return null
          const stack = stacks.find(s => s.id === p.stackId)
          const isSelected = n.id === selectedId
          const link = links.get(n.id)
          const color = typeColors[n.type] ?? '#80877F'
          // A reference of the selected card comes to the top of its pile
          const hidden = p.hidden && !link && !isSelected
          return (
            <button
              key={n.id}
              type="button"
              tabIndex={hidden ? -1 : 0}
              aria-hidden={hidden || undefined}
              title={n.title}
              onClick={() => (p.open ? onSelect(n.id) : stack && openPile(stack))}
              className={`absolute left-0 top-0 text-left rounded-[3px] border border-l-4 bg-index-card dark:bg-card px-3 py-2 cursor-pointer transition-[transform,opacity,box-shadow] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
                isSelected
                  ? 'ring-2 ring-bookcloth border-bookcloth shadow-[0_6px_18px_rgba(18,23,24,0.22)]'
                  : link?.suggestion
                    ? 'outline-2 outline-dashed outline-catalog-red border-line'
                    : link
                      ? 'ring-2 ring-ruling-blue border-line'
                      : 'border-line shadow-[0_1px_3px_rgba(18,23,24,0.12)] hover:shadow-[0_4px_12px_rgba(18,23,24,0.18)]'
              }`}
              style={{
                width: CARD_W, height: CARD_H, borderLeftColor: color,
                transform: `translate(${p.x - CARD_W / 2}px, ${p.y - CARD_H / 2}px) rotate(${p.rotate}deg)`,
                zIndex: isSelected ? 3000 : link ? p.z + 1000 : p.z,
                opacity: hidden ? 0 : 1,
                pointerEvents: hidden ? 'none' : undefined,
              }}
            >
              <span className="flex items-center gap-1.5 font-mono text-[10px] leading-3 tracking-[0.06em] uppercase text-ink-muted group-data-[zoom=far]/table:invisible">
                <span className="truncate">{n.type}</span>
                {flagged.has(n.id) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-catalog-red shrink-0" title="Open suggestion in the Inbox" />}
              </span>
              <span className="mt-1 block font-serif text-[15px] leading-[1.25] text-ink line-clamp-2 group-data-[zoom=far]/table:invisible">
                {n.title}
              </span>
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-[3px] border border-line bg-card/95 p-1 shadow-sm" onPointerDown={e => e.stopPropagation()}>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1 / 1.4)} className="h-7 w-7 text-base text-ink rounded-[2px] cursor-pointer hover:bg-paper">−</button>
        <span ref={zoomLabelRef} className="w-11 text-center font-mono text-[11px] text-ink-muted tabular-nums">50%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, 1.4)} className="h-7 w-7 text-base text-ink rounded-[2px] cursor-pointer hover:bg-paper">+</button>
        <button type="button" onClick={closePiles} className="h-7 px-2 text-xs text-ink rounded-[2px] cursor-pointer hover:bg-paper border-l border-line">All piles</button>
      </div>
      <p className="hidden md:block absolute bottom-3 left-3 z-10 px-2 py-1 rounded-[3px] bg-paper/90 font-mono text-[11px] text-ink-muted pointer-events-none">
        Scroll to zoom · drag to move · click a pile to spread it out
      </p>
    </div>
  )
}
