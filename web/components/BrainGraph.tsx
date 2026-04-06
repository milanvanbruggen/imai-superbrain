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

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => setMounted(true), [])

  // Track container dimensions so the graph always fills and centers in remaining space
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

  // Configure d3 forces for a tighter, less drifty layout
  useEffect(() => {
    const fg = graphRef.current
    if (!fg || !size) return
    fg.d3Force('charge')?.strength(-60)
    fg.d3Force('link')?.distance(60)
  }, [size])

  // Degree per node — more connections = larger node
  const degreeById = useMemo(() => {
    const map: Record<string, number> = {}
    edges.forEach(e => {
      map[e.source] = (map[e.source] ?? 0) + 1
      map[e.target] = (map[e.target] ?? 0) + 1
    })
    return map
  }, [edges])

  // Neighbors of the selected node — always shown at full opacity
  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return new Set<string>()
    const set = new Set<string>()
    edges.forEach(e => {
      if (e.source === selectedId) set.add(e.target)
      if (e.target === selectedId) set.add(e.source)
    })
    return set
  }, [selectedId, edges])

  const isDark = !mounted || resolvedTheme === 'dark'
  const bgColor = isDark ? '#030712' : '#f8fafc'
  const defaultLinkColor = isDark ? '#374151' : '#cbd5e1'

  const NODE_REL_SIZE = 6

  const graphData = {
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      return {
        ...n,
        color: TYPE_COLORS[n.type] ?? '#94a3b8',
        val: deg === 0 ? 0.4 : Math.min(1 + deg * 0.4, 4),
      }
    }),
    links: edges.map(e => ({
      source: e.source,
      target: e.target,
      typed: e.typed,
    })),
  }

  function isNodeDimmed(nodeId: string, nodeType: string): boolean {
    if (activeTypes.size === 0) return false
    if (nodeId === selectedId) return false
    if (selectedNeighbors.has(nodeId)) return false
    return !activeTypes.has(nodeType)
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {size && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel="title"
          nodeRelSize={NODE_REL_SIZE}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(node: any) => onSelectNode(node.id as string)}
          backgroundColor={bgColor}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D) => {
            const dimmed = isNodeDimmed(node.id as string, node.type as string)
            const r = Math.sqrt(node.val as number) * NODE_REL_SIZE
            const isSelected = node.id === selectedId

            ctx.globalAlpha = dimmed ? 0.1 : 1

            // Selection ring
            if (isSelected) {
              ctx.beginPath()
              ctx.arc(node.x as number, node.y as number, r + 4, 0, 2 * Math.PI)
              ctx.fillStyle = node.color as string
              ctx.globalAlpha = 0.2
              ctx.fill()
              ctx.globalAlpha = 1
            }

            ctx.beginPath()
            ctx.arc(node.x as number, node.y as number, r, 0, 2 * Math.PI)
            ctx.fillStyle = node.color as string
            ctx.fill()

            ctx.globalAlpha = 1
          }}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(link: any) => {
            if (activeTypes.size === 0) {
              return (link.typed as boolean) ? '#f97316' : defaultLinkColor
            }
            const src = link.source as any
            const tgt = link.target as any
            const srcId = src?.id ?? src
            const tgtId = tgt?.id ?? tgt
            const srcType = src?.type as string | undefined
            const tgtType = tgt?.type as string | undefined
            // Edge is visible if either endpoint is active or is selected/neighbor
            const srcVisible = !isNodeDimmed(srcId, srcType ?? '')
            const tgtVisible = !isNodeDimmed(tgtId, tgtType ?? '')
            if (!srcVisible && !tgtVisible) return isDark ? '#111827' : '#f1f5f9'
            const baseColor = (link.typed as boolean) ? '#f97316' : defaultLinkColor
            return (!srcVisible || !tgtVisible) ? baseColor + '55' : baseColor
          }}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
