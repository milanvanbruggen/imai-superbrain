'use client'
import { useEffect, useMemo, useState } from 'react'
import type { GraphEdge, GraphNode, VaultNote } from '@/lib/types'
import type { Suggestion } from '@/lib/suggestions'

// The card view: one note as an index card in the middle, its "see also" references around it.
// Layout follows the "Kaart" artboard of the AI Superbrain design.

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  notesByPath: Record<string, VaultNote>
  focusId: string | null
  onFocus: (id: string) => void
  typeColors: Record<string, string>
  suggestions: Suggestion[]
  onOpenInbox: () => void
}

const MAX_RING = 12
const MAX_FAR_PER_NEIGHBOUR = 3
const CARD_W = 176
const CARD_H = 62
const NARROW = 720

interface Ref { node: GraphNode; relation: string | null; suggestion?: Suggestion }

export function excerpt(markdown: string, max = 180): string {
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

/** Measures an element; a callback ref, so it follows the element when it is swapped. */
function useSize() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size] as const
}

function typeLabel(type: string): string {
  return type.toUpperCase()
}

export function CardView({ nodes, edges, notesByPath, focusId, onFocus, typeColors, suggestions, onOpenInbox }: Props) {
  const [depth, setDepth] = useState<1 | 2>(1)
  const [showAll, setShowAll] = useState(false)
  const [outerRef, outer] = useSize()
  const [areaRef, size] = useSize()
  const narrow = outer.w > 0 && outer.w < NARROW

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const focus = focusId ? byId.get(focusId) ?? null : null
  const note = focus ? notesByPath[focus.path] : null

  // Direct references, typed ones first; open suggestions for this card join the ring, dashed
  const refs = useMemo<Ref[]>(() => {
    if (!focus) return []
    const seen = new Map<string, Ref>()
    for (const e of edges) {
      const other = e.source === focus.id ? e.target : e.target === focus.id ? e.source : null
      if (!other || other === focus.id) continue
      const node = byId.get(other)
      if (!node) continue
      const prev = seen.get(other)
      if (!prev || (!prev.relation && e.relationType)) seen.set(other, { node, relation: e.relationType ?? null })
    }
    for (const s of suggestions) {
      const other = s.source === focus.path ? s.target : s.target === focus.path ? s.source : null
      const node = other ? byId.get(other) : undefined
      if (!node) continue
      const existing = seen.get(node.id)
      seen.set(node.id, { node, relation: existing?.relation ?? null, suggestion: s })
    }
    return [...seen.values()].sort((a, b) =>
      Number(!!b.suggestion) - Number(!!a.suggestion)
      || Number(!!b.relation) - Number(!!a.relation)
      || a.node.title.localeCompare(b.node.title))
  }, [focus, edges, suggestions, byId])

  const ring = showAll ? refs : refs.slice(0, MAX_RING)
  const hidden = refs.length - ring.length

  // Second step: references of references, drawn small beyond their parent card
  const far = useMemo(() => {
    if (!focus || depth === 1) return new Map<string, GraphNode[]>()
    const near = new Set([focus.id, ...ring.map(r => r.node.id)])
    const used = new Set<string>()
    const result = new Map<string, GraphNode[]>()
    for (const r of ring) {
      const list: GraphNode[] = []
      for (const e of edges) {
        const other = e.source === r.node.id ? e.target : e.target === r.node.id ? e.source : null
        if (!other || near.has(other) || used.has(other)) continue
        const node = byId.get(other)
        if (!node) continue
        used.add(other)
        list.push(node)
        if (list.length >= MAX_FAR_PER_NEIGHBOUR) break
      }
      result.set(r.node.id, list)
    }
    return result
  }, [focus, depth, ring, edges, byId])

  // Card positions on one or two ellipses around the centre
  const layout = useMemo(() => {
    const cx = size.w / 2
    const cy = size.h / 2
    const twoRings = ring.length > 8
    return ring.map((r, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(ring.length, 1)) * Math.PI * 2
      const outer = !twoRings || i % 2 === 0
      const rx = Math.max(220, size.w * (outer ? 0.38 : 0.27))
      const ry = Math.max(150, size.h * (outer ? 0.38 : 0.27))
      const x = cx + Math.cos(angle) * rx
      const y = cy + Math.sin(angle) * ry
      const farNodes = (far.get(r.node.id) ?? []).map((n, j, all) => {
        const spread = (j - (all.length - 1) / 2) * 0.22
        const a = angle + spread
        return { node: n, x: x + Math.cos(a) * 120, y: y + Math.sin(a) * 92 }
      })
      return { ...r, x, y, far: farNodes }
    })
  }, [ring, far, size])

  if (!focus || !note) {
    return (
      <div ref={outerRef} className="h-full flex items-center justify-center text-sm text-ink-muted">
        Pick a card from a drawer, or search for one.
      </div>
    )
  }

  const focusSuggestions = refs.filter(r => r.suggestion).length
  const focusInk = typeColors[focus.type] ?? '#6E7573'

  const focusCard = (
    <article
      className="bg-index-card text-[#1D2330] rounded-[3px] shadow-[0_1px_0_var(--color-line),0_8px_22px_rgba(29,35,48,0.16)]"
      style={{ width: narrow ? '100%' : 320 }}
    >
      <div className="border-t-[3px] border-index-red" />
      <div className="px-5 pt-3 pb-4">
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-[#555C68]">
          <span className="inline-block w-3 h-[3px] mr-2 align-middle" style={{ backgroundColor: focusInk }} />
          {typeLabel(focus.type)}
        </span>
        <h2 className="font-serif font-medium text-[26px] leading-8 mt-1 mb-2 [text-wrap:balance]">{focus.title}</h2>
        {excerpt(note.content) && (
          <p className="ruled text-sm leading-[21px] text-[#555C68]">{excerpt(note.content)}</p>
        )}
        <p className="font-mono text-xs text-[#555C68] mt-3">
          {refs.length - focusSuggestions} reference{refs.length - focusSuggestions === 1 ? '' : 's'}
          {focusSuggestions > 0 && ` · ${focusSuggestions} suggestion${focusSuggestions === 1 ? '' : 's'}`}
        </p>
      </div>
    </article>
  )

  const refCard = (r: Ref, style?: React.CSSProperties) => {
    const ink = typeColors[r.node.type] ?? '#6E7573'
    return (
      <button
        key={r.node.id}
        type="button"
        onClick={() => onFocus(r.node.id)}
        style={style}
        className={`text-left bg-card rounded-[3px] px-3 py-2 cursor-pointer transition-transform hover:-translate-y-0.5 ${
          r.suggestion ? 'border-[1.5px] border-dashed border-catalog-red' : 'shadow-[0_1px_0_var(--color-line),0_2px_6px_rgba(29,35,48,0.08)]'
        }`}
      >
        {!r.suggestion && <span className="block -mx-3 -mt-2 mb-1.5 border-t-[3px] rounded-t-[3px]" style={{ borderColor: ink }} />}
        <span className={`block text-[11px] leading-[14px] font-semibold tracking-[0.08em] ${r.suggestion ? 'text-catalog-red' : 'text-ink-muted'}`}>
          {typeLabel(r.node.type)}{r.suggestion && ' · SUGGESTION'}
        </span>
        <span className="block font-serif font-medium text-base leading-[21px] text-ink truncate">{r.node.title}</span>
      </button>
    )
  }

  const controls = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="font-mono text-[13px] text-ink-muted truncate">{focus.path}</p>
      <div role="group" aria-label="Depth" className="flex">
        {([1, 2] as const).map(d => (
          <button
            key={d}
            type="button"
            aria-pressed={depth === d}
            onClick={() => setDepth(d)}
            className={`h-8 px-3 text-[13px] border border-line-strong cursor-pointer ${d === 1 ? 'rounded-l-[3px]' : 'rounded-r-[3px] border-l-0'} ${
              depth === d ? 'bg-card text-ink font-semibold' : 'bg-transparent text-ink-muted'
            }`}
          >
            {d === 1 ? '1 step' : '2 steps'}
          </button>
        ))}
      </div>
    </div>
  )

  // Phone width: the web of lines becomes a list under the card
  if (narrow) {
    return (
      <div ref={outerRef} className="h-full overflow-y-auto p-4 flex flex-col gap-4">
        {controls}
        {focusCard}
        {refs.some(r => r.suggestion) && (
          <button type="button" onClick={onOpenInbox} className="text-left text-sm px-4 py-3 border-[1.5px] border-dashed border-catalog-red rounded-[3px] cursor-pointer">
            <span className="block text-[11px] font-semibold tracking-[0.08em] text-catalog-red">SUGGESTION</span>
            Review it in the Inbox
          </button>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-muted">SEE ALSO · {refs.length}</span>
          {refs.map(r => (
            <div key={r.node.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">{refCard(r, { width: '100%' })}</div>
              {r.relation && <span className="font-mono text-xs text-ruling-blue shrink-0">{r.relation}</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const cx = size.w / 2
  const cy = size.h / 2

  return (
    <div ref={outerRef} className="h-full flex flex-col gap-3 p-5 pb-4">
      {controls}
      <div ref={areaRef} className="relative flex-1 min-h-0">
        {size.w > 0 && (
          <>
            <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none">
              {layout.flatMap(p => p.far.map(f => (
                <line key={`far-${p.node.id}-${f.node.id}`} x1={p.x} y1={p.y} x2={f.x} y2={f.y} stroke="var(--color-line)" strokeWidth={1} />
              )))}
              {layout.map(p => (
                <line
                  key={`l-${p.node.id}`} x1={cx} y1={cy} x2={p.x} y2={p.y}
                  stroke={p.suggestion ? 'var(--color-catalog-red)' : 'var(--color-ruling-blue)'}
                  strokeWidth={1.5}
                  strokeDasharray={p.suggestion ? '5 5' : undefined}
                />
              ))}
            </svg>

            {layout.map(p => (p.relation || p.suggestion) && (
              <span
                key={`t-${p.node.id}`}
                className={`absolute font-mono text-xs px-1 bg-paper -translate-x-1/2 -translate-y-1/2 pointer-events-none ${p.suggestion ? 'text-catalog-red' : 'text-ruling-blue'}`}
                style={{ left: cx + (p.x - cx) * 0.55, top: cy + (p.y - cy) * 0.55 }}
              >
                {p.suggestion ? `suggestion · ${p.suggestion.kind === 'merge' ? 'merge?' : p.suggestion.relationType}` : p.relation}
              </span>
            ))}

            {layout.flatMap(p => p.far.map(f => (
              <button
                key={`f-${p.node.id}-${f.node.id}`}
                type="button"
                title={f.node.title}
                aria-label={f.node.title}
                onClick={() => onFocus(f.node.id)}
                className="absolute w-6 h-4 -translate-x-1/2 -translate-y-1/2 bg-card border border-line rounded-[2px] cursor-pointer hover:border-line-strong"
                style={{ left: f.x, top: f.y, borderTop: `2px solid ${typeColors[f.node.type] ?? '#80877F'}` }}
              />
            )))}

            <div className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: cx, top: cy }}>{focusCard}</div>

            {layout.map(p => refCard(p, {
              position: 'absolute', left: p.x, top: p.y, width: CARD_W, minHeight: CARD_H, transform: 'translate(-50%, -50%)',
            }))}

            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="absolute right-0 bottom-0 h-8 px-3 text-[13px] border border-line-strong rounded-[3px] bg-card text-ink cursor-pointer"
              >
                Show {hidden} more
              </button>
            )}
            {refs.length === 0 && (
              <p className="absolute left-1/2 top-[calc(50%+130px)] -translate-x-1/2 text-sm text-ink-muted text-center max-w-xs">
                This card has no references yet. Link it from its notes, or let the AI review suggest one.
              </p>
            )}
          </>
        )}
      </div>
      <p className="font-mono text-xs text-ink-muted">Click a card to go there · switch to Table for the whole archive</p>
    </div>
  )
}
