'use client'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useEffect, useState, useRef, useMemo } from 'react'
import { GraphNode, GraphEdge } from '@/lib/types'

const ForceGraph2D = dynamic(
  () => import('react-force-graph-2d'),
  { ssr: false }
)

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  onSelectNode: (id: string) => void
  activeTypes: Set<string>
}

export const TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa',
  project: '#34d399',
  idea: '#f59e0b',
  resource: '#a78bfa',
  note: '#94a3b8',
  meeting: '#06B6D4',
  daily: '#6B7280',
  area: '#EC4899',
}

const NODE_REL_SIZE = 4
// Minimum arc distance between nodes on the same ring — guarantees labels don't overlap
const MIN_ARC_SPACING = 130
// Minimum radial gap between consecutive rings
const MIN_RING_GAP = 180

function truncate(s: string, max = 20): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * BFS radial layout — hub at centre, each BFS ring placed at the radius
 * required to give all nodes on that ring at least MIN_ARC_SPACING of space.
 * Returns a Map of nodeId → {x, y} in graph coordinate space (hub at 0,0).
 */
function computeRadialPositions(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const adj: Record<string, Set<string>> = {}
  nodes.forEach(n => { adj[n.id] = new Set() })
  edges.forEach(e => {
    adj[e.source]?.add(e.target)
    adj[e.target]?.add(e.source)
  })

  const degree = (id: string) => adj[id]?.size ?? 0
  const hub = [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0]
  const pos = new Map<string, { x: number; y: number }>()
  const visited = new Set<string>()

  if (!hub) return pos

  pos.set(hub.id, { x: 0, y: 0 })
  visited.add(hub.id)

  let frontier = [hub.id]
  let currentRadius = 0

  while (frontier.length > 0) {
    const next: string[] = []
    frontier.forEach(id => {
      adj[id]?.forEach(nid => {
        if (!visited.has(nid)) { visited.add(nid); next.push(nid) }
      })
    })
    if (next.length === 0) break

    // Ring radius: enough arc space for all nodes on this ring
    const minForSpacing = (next.length * MIN_ARC_SPACING) / (2 * Math.PI)
    currentRadius += Math.max(MIN_RING_GAP, minForSpacing)

    next.forEach((id, i) => {
      const angle = (i / next.length) * 2 * Math.PI - Math.PI / 2
      pos.set(id, {
        x: currentRadius * Math.cos(angle),
        y: currentRadius * Math.sin(angle),
      })
    })
    frontier = next
  }

  // Disconnected nodes (no path to hub) — outer ring
  const orphans = nodes.filter(n => !visited.has(n.id))
  if (orphans.length > 0) {
    const minForSpacing = (orphans.length * MIN_ARC_SPACING) / (2 * Math.PI)
    currentRadius += Math.max(MIN_RING_GAP, minForSpacing)
    orphans.forEach((n, i) => {
      const angle = (i / orphans.length) * 2 * Math.PI - Math.PI / 2
      pos.set(n.id, {
        x: currentRadius * Math.cos(angle),
        y: currentRadius * Math.sin(angle),
      })
    })
  }

  return pos
}

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Disable centering + physics since positions are pre-computed.
  // Keep a tiny charge so dragged (unpinned) nodes don't fly off.
  useEffect(() => {
    const timer = setTimeout(() => {
      const fg = graphRef.current
      if (!fg) return
      fg.d3Force('center', null)
      fg.d3Force('charge')?.strength(-80)
      fg.d3Force('link')?.strength(0)
    }, 30)
    return () => clearTimeout(timer)
  }, [size])

  const degreeById = useMemo(() => {
    const map: Record<string, number> = {}
    edges.forEach(e => {
      map[e.source] = (map[e.source] ?? 0) + 1
      map[e.target] = (map[e.target] ?? 0) + 1
    })
    return map
  }, [edges])

  const neighborsOf = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    nodes.forEach(n => { map[n.id] = new Set() })
    edges.forEach(e => {
      map[e.source]?.add(e.target)
      map[e.target]?.add(e.source)
    })
    return map
  }, [nodes, edges])

  const radialPositions = useMemo(
    () => computeRadialPositions(nodes, edges),
    [nodes, edges]
  )

  const isDark = !mounted || resolvedTheme === 'dark'
  const bgColor = isDark ? '#030712' : '#f8fafc'
  const defaultLinkColor = isDark ? '#374151' : '#d1d5db'
  const labelColorDim = isDark ? '#4b5563' : '#9ca3af'
  const labelColorFocus = isDark ? '#e5e7eb' : '#1f2937'

  const graphData = useMemo(() => ({
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      const rp = radialPositions.get(n.id)
      return {
        ...n,
        color: TYPE_COLORS[n.type] ?? '#94a3b8',
        val: deg === 0 ? 0.3 : Math.min(0.5 + deg * 0.2, 2.5),
        // Pin nodes to computed positions; dragging clears fx/fy automatically
        fx: rp?.x,
        fy: rp?.y,
      }
    }),
    links: edges.map(e => ({ source: e.source, target: e.target, typed: e.typed })),
  }), [nodes, edges, degreeById, radialPositions])

  const focusId = hoveredId ?? selectedId
  const focusNeighbors: Set<string> = focusId ? (neighborsOf[focusId] ?? new Set()) : new Set()

  function isNodeDimmed(nodeId: string, nodeType: string): boolean {
    if (focusId !== null) return nodeId !== focusId && !focusNeighbors.has(nodeId)
    if (activeTypes.size === 0) return false
    return !activeTypes.has(nodeType)
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {size && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel=""
          nodeRelSize={NODE_REL_SIZE}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          d3AlphaDecay={0.1}
          d3VelocityDecay={0.5}
          onNodeClick={(node: any) => onSelectNode(node.id as string)}
          onNodeHover={(node: any) => setHoveredId(node?.id ?? null)}
          backgroundColor={bgColor}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const nodeId = node.id as string
            const nodeType = node.type as string
            const dimmed = isNodeDimmed(nodeId, nodeType)
            const isSelected = nodeId === selectedId
            const isHovered = nodeId === hoveredId
            const isFocused = nodeId === focusId || focusNeighbors.has(nodeId)
            const r = Math.sqrt(node.val as number) * NODE_REL_SIZE
            const x = node.x as number
            const y = node.y as number

            // Selection / hover ring
            if (isSelected || isHovered) {
              ctx.globalAlpha = 0.2
              ctx.beginPath()
              ctx.arc(x, y, r + 4, 0, 2 * Math.PI)
              ctx.fillStyle = node.color as string
              ctx.fill()
            }

            // Node dot
            ctx.globalAlpha = dimmed ? 0.07 : 1
            ctx.beginPath()
            ctx.arc(x, y, r, 0, 2 * Math.PI)
            ctx.fillStyle = node.color as string
            ctx.fill()

            // Label — always visible in radial layout (spacing guaranteed)
            const label = truncate((node.title as string) ?? nodeId)
            const fontSize = Math.min(11, Math.max(4, 10 / globalScale))
            ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.globalAlpha = dimmed ? 0.07 : 1
            ctx.fillStyle = isFocused ? labelColorFocus : labelColorDim
            ctx.fillText(label, x, y + r + 2)

            ctx.globalAlpha = 1
          }}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(link: any) => {
            const src = link.source as any
            const tgt = link.target as any
            const srcDimmed = isNodeDimmed(src?.id ?? src, src?.type ?? '')
            const tgtDimmed = isNodeDimmed(tgt?.id ?? tgt, tgt?.type ?? '')
            const base = (link.typed as boolean) ? '#f97316' : defaultLinkColor
            if (srcDimmed && tgtDimmed) return isDark ? '#1a2030' : '#f3f4f6'
            if (srcDimmed || tgtDimmed) return base + '44'
            return base
          }}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
