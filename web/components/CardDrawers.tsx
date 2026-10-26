'use client'
import { useMemo, useState } from 'react'
import type { GraphEdge, GraphNode } from '@/lib/types'
import { unconnectedPaths } from '@/lib/suggestions'

// The drawers beside the card view: one per note type, plus the cards without any reference.

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  focusId: string | null
  onFocus: (id: string) => void
  typeColors: Record<string, string>
  recent: string[]
}

const UNCONNECTED = '__unconnected__'

export function CardDrawers({ nodes, edges, focusId, onFocus, typeColors, recent }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const drawers = useMemo(() => {
    const byType = new Map<string, GraphNode[]>()
    for (const n of nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), n])
    return [...byType.entries()]
      .map(([type, list]) => ({ type, list: list.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => b.list.length - a.list.length)
  }, [nodes])

  const unconnected = useMemo(() => {
    const paths = unconnectedPaths(nodes, edges)
    return nodes.filter(n => paths.has(n.path)).sort((a, b) => a.title.localeCompare(b.title))
  }, [nodes, edges])

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const recentNodes = recent.map(id => byId.get(id)).filter((n): n is GraphNode => !!n && n.id !== focusId).slice(0, 5)
  const focusType = focusId ? byId.get(focusId)?.type : undefined

  const list = (items: GraphNode[]) => (
    <ul className="flex flex-col py-1 pl-4 max-h-64 overflow-y-auto">
      {items.map(n => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onFocus(n.id)}
            className={`w-full text-left px-2 py-1 text-[13px] leading-5 rounded-[3px] truncate cursor-pointer hover:bg-card ${n.id === focusId ? 'text-ink font-semibold' : 'text-ink-muted'}`}
          >
            {n.title}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <nav aria-label="Drawers" className="h-full overflow-y-auto py-5 pl-5 pr-2 flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-ink-muted px-3 pb-2">DRAWERS</span>
        {drawers.map(d => (
          <div key={d.type}>
            <button
              type="button"
              aria-expanded={open === d.type}
              onClick={() => setOpen(open === d.type ? null : d.type)}
              className={`w-full flex justify-between items-center px-3 py-2 text-sm border-l-[3px] cursor-pointer hover:bg-card ${focusType === d.type ? 'bg-card font-semibold text-ink' : 'text-ink'}`}
              style={{ borderLeftColor: typeColors[d.type] ?? '#80877F' }}
            >
              <span className="capitalize truncate">{d.type}</span>
              <span className="font-mono text-[13px] text-ink-muted font-normal">{d.list.length}</span>
            </button>
            {open === d.type && list(d.list)}
          </div>
        ))}
        {unconnected.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={open === UNCONNECTED}
              onClick={() => setOpen(open === UNCONNECTED ? null : UNCONNECTED)}
              className="w-full flex justify-between items-center px-3 py-2 text-sm text-ink-muted border border-dashed border-line-strong rounded-[3px] cursor-pointer hover:bg-card"
            >
              <span>No references</span>
              <span className="font-mono text-[13px]">{unconnected.length}</span>
            </button>
            {open === UNCONNECTED && list(unconnected)}
          </div>
        )}
      </div>

      {recentNodes.length > 0 && (
        <div className="flex flex-col gap-1 px-3">
          <span className="text-[11px] leading-[14px] font-semibold tracking-[0.08em] text-ink-muted pb-1">RECENTLY VIEWED</span>
          {recentNodes.map(n => (
            <button key={n.id} type="button" onClick={() => onFocus(n.id)} className="text-left text-sm text-ink truncate cursor-pointer hover:text-ruling-blue">
              {n.title}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}
