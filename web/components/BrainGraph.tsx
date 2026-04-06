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

function truncate(s: string, max = 22): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
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

  // Apply forces once the graph is mounted. Called via onEngineStop so the
  // ref is guaranteed to be populated, then re-heat to spread from new config.
  const forcesApplied = useRef(false)
  function applyForces() {
    if (forcesApplied.current) return
    const fg = graphRef.current
    if (!fg) return
    forcesApplied.current = true
    fg.d3Force('charge')?.strength(-2500)
    fg.d3Force('link')?.distance(180).strength(0.05)
    fg.d3ReheatSimulation()
  }

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

  const isDark = !mounted || resolvedTheme === 'dark'
  const bgColor = isDark ? '#030712' : '#f8fafc'
  const defaultLinkColor = isDark ? '#374151' : '#d1d5db'
  const labelColorDim = isDark ? '#4b5563' : '#9ca3af'
  const labelColorFocus = isDark ? '#e5e7eb' : '#1f2937'

  const graphData = useMemo(() => ({
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      return {
        ...n,
        color: TYPE_COLORS[n.type] ?? '#94a3b8',
        val: deg === 0 ? 0.3 : Math.min(0.5 + deg * 0.25, 2.5),
      }
    }),
    links: edges.map(e => ({
      source: e.source,
      target: e.target,
      typed: e.typed,
    })),
  }), [nodes, edges, degreeById])

  // Focus: hovered takes priority over selected
  const focusId = hoveredId ?? selectedId
  const focusNeighbors: Set<string> = focusId ? (neighborsOf[focusId] ?? new Set()) : new Set()

  function isNodeDimmed(nodeId: string, nodeType: string): boolean {
    if (focusId !== null) {
      return nodeId !== focusId && !focusNeighbors.has(nodeId)
    }
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
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.25}
          warmupTicks={60}
          onEngineStop={applyForces}
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

            // Label: always for focused cluster; for others only when zoomed in
            const showLabel = isFocused || globalScale > 1.2
            if (showLabel) {
              const label = truncate((node.title as string) ?? nodeId)
              const fontSize = Math.min(11, Math.max(4, 10 / globalScale))
              ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.globalAlpha = dimmed ? 0.07 : 1
              ctx.fillStyle = isFocused ? labelColorFocus : labelColorDim
              ctx.fillText(label, x, y + r + 2)
            }

            ctx.globalAlpha = 1
          }}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(link: any) => {
            const src = link.source as any
            const tgt = link.target as any
            const srcId: string = src?.id ?? src
            const tgtId: string = tgt?.id ?? tgt
            const srcType: string = src?.type ?? ''
            const tgtType: string = tgt?.type ?? ''
            const srcDimmed = isNodeDimmed(srcId, srcType)
            const tgtDimmed = isNodeDimmed(tgtId, tgtType)
            const baseColor = (link.typed as boolean) ? '#f97316' : defaultLinkColor
            if (srcDimmed && tgtDimmed) return isDark ? '#1a2030' : '#f3f4f6'
            if (srcDimmed || tgtDimmed) return baseColor + '44'
            return baseColor
          }}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
