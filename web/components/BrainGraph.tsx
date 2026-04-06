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
  onSelectNode: (id: string | null) => void
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

const NODE_REL_SIZE = 3.5
// Minimum distance between node centres — keeps the compact organic cluster readable
const COLLIDE_DIST = 20

function truncate(s: string, max = 20): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Pure-JS gravity force for isolated nodes (degree 0).
 * Pulls them toward the origin so they stay near the main cluster.
 */
function createIsolatedGravity(connectedIds: Set<string>, strength = 0.06) {
  let simNodes: any[] = []
  function force() {
    for (const node of simNodes) {
      if (connectedIds.has(node.id)) continue
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * strength
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * strength
    }
  }
  ;(force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}

/**
 * Pure-JS collision force compatible with d3-force-3d simulations.
 * Prevents node centres coming closer than `minDist` px.
 */
function createCollideForce(minDist: number) {
  let simNodes: any[] = []
  function force() {
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const dx = (simNodes[j].x - simNodes[i].x) || 0.001
        const dy = (simNodes[j].y - simNodes[i].y) || 0.001
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < minDist) {
          const push = ((minDist - dist) / minDist) * 0.8
          simNodes[i].vx = (simNodes[i].vx ?? 0) - dx * push
          simNodes[i].vy = (simNodes[i].vy ?? 0) - dy * push
          simNodes[j].vx = (simNodes[j].vx ?? 0) + dx * push
          simNodes[j].vy = (simNodes[j].vy ?? 0) + dy * push
        }
      }
    }
  }
  ; (force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Track last drag position to compute throw velocity on release
  const lastDragRef = useRef<{ x: number; y: number; t: number } | null>(null)

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

  const degreeById = useMemo(() => {
    const map: Record<string, number> = {}
    edges.forEach(e => {
      map[e.source] = (map[e.source] ?? 0) + 1
      map[e.target] = (map[e.target] ?? 0) + 1
    })
    return map
  }, [edges])

  // Obsidian-style physics:
  // - Short link distance keeps connected nodes close (organic cluster)
  // - Weak charge just nudges disconnected nodes apart
  // - Custom collision prevents overlap inside the cluster
  // - Isolated gravity pulls degree-0 nodes toward the cluster center
  useEffect(() => {
    const timer = setTimeout(() => {
      const fg = graphRef.current
      if (!fg) return
      const connectedIds = new Set(Object.keys(degreeById))
      fg.d3Force('charge')?.strength(-20)
      fg.d3Force('link')?.distance(45).strength(0.9)
      fg.d3Force('collide', createCollideForce(COLLIDE_DIST))
      fg.d3Force('isolatedGravity', createIsolatedGravity(connectedIds, 0.06))
      fg.d3ReheatSimulation()
    }, 30)
    return () => clearTimeout(timer)
  }, [size, degreeById])

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
  // Subtle edge colors — same as Obsidian (no bright orange distracting from structure)
  const edgeColor = isDark ? '#2d3748' : '#cbd5e1'
  const edgeColorFocus = isDark ? '#4b5563' : '#94a3b8'
  const edgeColorTyped = isDark ? '#374151' : '#b0bec5'
  const labelColorDim = isDark ? '#374151' : '#9ca3af'
  const labelColorActive = isDark ? '#d1d5db' : '#1f2937'

  const graphData = useMemo(() => ({
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      return {
        ...n,
        color: TYPE_COLORS[n.type] ?? '#94a3b8',
        // Degree-proportional size: hub is visibly larger
        val: deg === 0 ? 0.4 : Math.min(0.6 + deg * 0.15, 3),
      }
    }),
    links: edges.map(e => ({ source: e.source, target: e.target, typed: e.typed })),
  }), [nodes, edges, degreeById])

  // Center graph on selected node whenever selectedId changes.
  // graphData.nodes are mutated in-place by the d3 simulation, so they carry current x/y.
  useEffect(() => {
    if (!selectedId || !graphRef.current) return
    const node = graphData.nodes.find(n => n.id === selectedId) as any
    if (node?.x != null && node?.y != null) {
      graphRef.current.centerAt(node.x, node.y, 400)
    }
  }, [selectedId, graphData])

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
          linkDirectionalArrowLength={0}
          d3AlphaDecay={0.008}
          d3VelocityDecay={0.12}
          onNodeClick={(node: any) => onSelectNode(node.id as string)}
          onBackgroundClick={() => onSelectNode(null)}
          onNodeHover={(node: any) => setHoveredId(node?.id ?? null)}
          onNodeDrag={(node: any) => {
            setDraggingId(node.id)
            lastDragRef.current = { x: node.x, y: node.y, t: Date.now() }
          }}
          onNodeDragEnd={(node: any) => {
            // Apply throw velocity based on last movement delta
            const last = lastDragRef.current
            if (last && Date.now() - last.t < 80) {
              node.vx = (node.x - last.x) * 4
              node.vy = (node.y - last.y) * 4
            }
            lastDragRef.current = null
            setDraggingId(null)
            graphRef.current?.d3ReheatSimulation()
          }}
          backgroundColor={bgColor}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const nodeId = node.id as string
            const nodeType = node.type as string
            const dimmed = isNodeDimmed(nodeId, nodeType)
            const isSelected = nodeId === selectedId
            const isHovered = nodeId === hoveredId
            const isDragging = nodeId === draggingId
            const isFocused = nodeId === focusId || focusNeighbors.has(nodeId)
            const r = Math.sqrt(node.val as number) * NODE_REL_SIZE
            const x = node.x as number
            const y = node.y as number

            // Drag glow — larger, brighter ring while being moved
            if (isDragging) {
              ctx.globalAlpha = 0.25
              ctx.beginPath()
              ctx.arc(x, y, r + 6, 0, 2 * Math.PI)
              ctx.fillStyle = node.color as string
              ctx.fill()
            }

            // Selection / hover ring
            if ((isSelected || isHovered) && !isDragging) {
              ctx.globalAlpha = 0.18
              ctx.beginPath()
              ctx.arc(x, y, r + 3, 0, 2 * Math.PI)
              ctx.fillStyle = node.color as string
              ctx.fill()
            }

            // Node dot
            ctx.globalAlpha = dimmed ? 0.08 : 1
            ctx.beginPath()
            ctx.arc(x, y, r, 0, 2 * Math.PI)
            ctx.fillStyle = node.color as string
            ctx.fill()

            // Label — show always when zoomed in, or for focused cluster
            const showLabel = isFocused || globalScale > 0.9
            if (showLabel) {
              const label = truncate((node.title as string) ?? nodeId)
              const fontSize = Math.min(10, Math.max(3, 9 / globalScale))
              ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
              ctx.textAlign = 'center'
              ctx.textBaseline = 'top'
              ctx.globalAlpha = dimmed ? 0.08 : isFocused ? 1 : 0.75
              ctx.fillStyle = isFocused ? labelColorActive : labelColorDim
              ctx.fillText(label, x, y + r + 1.5)
            }

            ctx.globalAlpha = 1
          }}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={(link: any) => {
            const src = link.source as any
            const tgt = link.target as any
            const srcId: string = src?.id ?? src
            const tgtId: string = tgt?.id ?? tgt
            const srcDimmed = isNodeDimmed(srcId, src?.type ?? '')
            const tgtDimmed = isNodeDimmed(tgtId, tgt?.type ?? '')

            // When focused: highlight edges in the cluster, fade everything else
            if (focusId !== null) {
              if (srcDimmed && tgtDimmed) return isDark ? '#1a202c' : '#f8fafc'
              // Edge touches focused node/neighbor — show it
              const base = (link.typed as boolean) ? edgeColorTyped : edgeColor
              return srcDimmed || tgtDimmed ? base + '55' : edgeColorFocus
            }

            // No focus — uniform subtle edges
            if (activeTypes.size > 0 && (srcDimmed || tgtDimmed)) {
              return isDark ? '#1e2533' : '#f1f5f9'
            }
            return (link.typed as boolean) ? edgeColorTyped : edgeColor
          }}
          linkWidth={0.8}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
