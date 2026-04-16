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
  typeColors: Record<string, string>
}

export const DEFAULT_TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa',
  project: '#34d399',
  idea: '#f59e0b',
  resource: '#a78bfa',
  note: '#94a3b8',
  meeting: '#06B6D4',
  daily: '#6B7280',
  area: '#EC4899',
  group: '#fb923c',
  system: '#9CA3AF',
  template: '#C084FC',
}

const NODE_REL_SIZE = 3.5
// Padding added beyond each node's visual radius for collision detection.
// Accounts for label height (~12px below node) + comfortable breathing room.
const COLLIDE_PADDING = 14
// Above this node count reduce collision iterations to keep the simulation fast
const LARGE_GRAPH_THRESHOLD = 80

function truncate(s: string, max = 20): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Returns a lighter or darker tint of a hex color. ratio > 0 = lighter, < 0 = darker */
function tint(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if (ratio > 0) {
    return `rgb(${Math.round(r + (255 - r) * ratio)},${Math.round(g + (255 - g) * ratio)},${Math.round(b + (255 - b) * ratio)})`
  } else {
    const f = 1 + ratio
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`
  }
}

/**
 * Pulls ALL nodes gently toward the origin so the cluster stays centered.
 * Much weaker than isolatedGravity — topology still dominates positioning.
 */
function createCenterGravity(strength = 0.03) {
  let simNodes: any[] = []
  function force() {
    for (const node of simNodes) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * strength
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * strength
    }
  }
  ;(force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}

/**
 * Size-aware collision force compatible with d3-force simulations.
 *
 * Each node's collision radius is its visual radius (√val × NODE_REL_SIZE)
 * plus a constant padding that reserves space for labels and breathing room.
 * Running multiple iterations per tick converges overlaps that a single pass
 * would leave behind — the same strategy d3.forceCollide uses internally.
 *
 * For large graphs `iterations` is reduced to keep the O(n²) cost acceptable.
 */
function createCollideForce(padding: number, iterations = 3) {
  let simNodes: any[] = []

  function force() {
    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < simNodes.length; i++) {
        const a = simNodes[i]
        const ra = Math.sqrt(Math.max(a.val ?? 1, 0.01)) * NODE_REL_SIZE + padding

        for (let j = i + 1; j < simNodes.length; j++) {
          const b = simNodes[j]
          const rb = Math.sqrt(Math.max(b.val ?? 1, 0.01)) * NODE_REL_SIZE + padding
          const minDist = ra + rb

          let dx = (b.x ?? 0) - (a.x ?? 0)
          let dy = (b.y ?? 0) - (a.y ?? 0)
          // Avoid zero-length vector for exactly-overlapping nodes
          if (dx === 0 && dy === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1 }

          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < minDist) {
            // Proportional push: the deeper the overlap, the harder the push
            const strength = ((minDist - dist) / dist) * 0.5
            a.vx = (a.vx ?? 0) - dx * strength
            a.vy = (a.vy ?? 0) - dy * strength
            b.vx = (b.vx ?? 0) + dx * strength
            b.vy = (b.vy ?? 0) + dy * strength
          }
        }
      }
    }
  }

  ;(force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes, typeColors }: Props) {
  const isLargeGraph = nodes.length > LARGE_GRAPH_THRESHOLD
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)
  const initialZoomDone = useRef(false)
  const [graphReady, setGraphReady] = useState(false)

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

  // Organic physics:
  // - Charge -60 with distanceMax 120: repels nearby nodes (local spread)
  //   but doesn't push distant clusters apart — lets topology form clusters
  // - Link distance 45 pulls connected nodes close so hubs gather their neighbors
  // - Custom collision prevents overlap
  // - Universal center gravity (0.03) keeps the cluster from drifting
  useEffect(() => {
    // ForceGraph2D loads via dynamic import, so graphRef.current may not be set yet.
    // Retry until the instance is available (max ~3s).
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>

    function applyForces() {
      const fg = graphRef.current
      if (!fg) {
        if (++attempts < 30) timer = setTimeout(applyForces, 100)
        return
      }

      // Stronger repulsion + larger range → nodes spread out more before links pull them back.
      // distanceMax 160 means nodes up to ~5 screen radii apart still push each other away.
      fg.d3Force('charge')?.strength(-100).distanceMax(160)
      fg.d3Force('link')?.distance(50).strength(0.9)
      // Size-aware collision: 3 iterations for small graphs (converges well), 1 for large (O(n²) cost).
      // Never fully disabled — charge alone doesn't prevent overlap inside dense clusters.
      fg.d3Force('collide', createCollideForce(COLLIDE_PADDING, isLargeGraph ? 1 : 3))
      fg.d3Force('centerGravity', null)
      fg.d3Force('isolatedGravity', null)
      fg.d3Force('layer', null)
      fg.d3ReheatSimulation()

      // warmupTicks already positioned nodes before first render — wait two frames
      // for the canvas to be painted, then zoom to fit.
      if (!initialZoomDone.current) {
        initialZoomDone.current = true
        requestAnimationFrame(() => requestAnimationFrame(() => {
          fg.zoomToFit(400, 60)
          setTimeout(() => {
            fg.zoom(fg.zoom() * 0.7, 300)
            setGraphReady(true)
          }, 450)
        }))
      }
    }

    applyForces()
    return () => clearTimeout(timer)
  }, [size, isLargeGraph])

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
  const labelColorDim = isDark ? '#9ca3af' : '#6b7280'
  const labelColorActive = isDark ? '#f3f4f6' : '#1f2937'

  const graphData = useMemo(() => ({
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      return {
        ...n,
        color: typeColors[n.type] ?? '#94a3b8',
        // Degree-proportional size: hub is visibly larger
        val: deg === 0 ? 0.4 : Math.min(0.6 + deg * 0.15, 3),
      }
    }),
    links: edges.map(e => ({ source: e.source, target: e.target, typed: e.typed })),
  }), [nodes, edges, degreeById, typeColors])

  // Center graph on selected node whenever selectedId changes.
  // graphData.nodes are mutated in-place by the d3 simulation, so they carry current x/y.
  useEffect(() => {
    if (!selectedId || !graphRef.current) return
    const node = graphData.nodes.find(n => n.id === selectedId) as any
    if (node?.x != null && node?.y != null) {
      graphRef.current.centerAt(node.x, node.y, 400)
    }
  }, [selectedId, graphData])

  const xCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Cline x1='3' y1='3' x2='17' y2='17' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3Cline x1='17' y1='3' x2='3' y2='17' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3Cline x1='3' y1='3' x2='17' y2='17' stroke='%23374151' stroke-width='1.5' stroke-linecap='round'/%3E%3Cline x1='17' y1='3' x2='3' y2='17' stroke='%23374151' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 10 10, crosshair`

  const focusId = hoveredId ?? selectedId
  const focusNeighbors: Set<string> = focusId ? (neighborsOf[focusId] ?? new Set()) : new Set()

  function isNodeDimmed(nodeId: string, nodeType: string): boolean {
    if (focusId !== null) return nodeId !== focusId && !focusNeighbors.has(nodeId)
    if (activeTypes.size === 0) return false
    return !activeTypes.has(nodeType)
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        opacity: graphReady ? 1 : 0,
        transform: graphReady ? 'scale(1)' : 'scale(0.96)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
        cursor: hoveredId && hoveredId !== selectedId ? 'pointer'
          : !hoveredId && selectedId ? xCursor
          : 'default',
      }}
      onPointerDown={e => { pointerDownPos.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={e => {
        const down = pointerDownPos.current
        pointerDownPos.current = null
        if (!down) return
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        if (Math.sqrt(dx * dx + dy * dy) < 12) {
          // Small movement = click: select hovered node or deselect (background)
          onSelectNode(hoveredIdRef.current)
        }
      }}
    >
      {size && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeLabel=""
          nodeRelSize={NODE_REL_SIZE}
          linkDirectionalArrowLength={0}
          d3AlphaDecay={isLargeGraph ? 0.05 : 0.03}
          d3VelocityDecay={isLargeGraph ? 0.6 : 0.55}
          warmupTicks={isLargeGraph ? 300 : 150}
          cooldownTicks={isLargeGraph ? 100 : 300}
          onNodeHover={(node: any) => {
            const id = node?.id ?? null
            setHoveredId(id)
            hoveredIdRef.current = id
          }}
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

            const color = node.color as string
            const alpha = dimmed ? 0.08 : 1

            // Selection / hover ring
            if (isSelected || isHovered) {
              ctx.globalAlpha = alpha * 0.2
              ctx.beginPath()
              ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI)
              ctx.fillStyle = color
              ctx.fill()
            }

            // Sphere: radial gradient from highlight to base colour to dark edge
            ctx.globalAlpha = alpha
            ctx.beginPath()
            ctx.arc(x, y, r, 0, 2 * Math.PI)
            if (isFinite(x) && isFinite(y) && isFinite(r) && r > 0) {
              const grad = ctx.createRadialGradient(
                x - r * 0.25, y - r * 0.25, r * 0.05,
                x, y, r
              )
              grad.addColorStop(0,   tint(color, 0.18))
              grad.addColorStop(0.5, color)
              grad.addColorStop(1,   tint(color, -0.12))
              ctx.fillStyle = grad
            } else {
              ctx.fillStyle = color
            }
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
          linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const src = link.source as any
            const tgt = link.target as any
            if (src?.x == null || tgt?.x == null) return

            const srcId: string = src?.id ?? src
            const tgtId: string = tgt?.id ?? tgt
            const srcDimmed = isNodeDimmed(srcId, src?.type ?? '')
            const tgtDimmed = isNodeDimmed(tgtId, tgt?.type ?? '')

            // Compute edge color (same logic as before)
            let color: string
            if (focusId !== null) {
              if (srcDimmed && tgtDimmed) color = isDark ? '#1a202c' : '#f8fafc'
              else {
                const base = (link.typed as boolean) ? edgeColorTyped : edgeColor
                color = srcDimmed || tgtDimmed ? base + '55' : edgeColorFocus
              }
            } else if (activeTypes.size > 0 && (srcDimmed || tgtDimmed)) {
              color = isDark ? '#1e2533' : '#f1f5f9'
            } else {
              color = (link.typed as boolean) ? edgeColorTyped : edgeColor
            }

            const isPerson2Person = src?.type === 'person' && tgt?.type === 'person'

            ctx.beginPath()
            ctx.moveTo(src.x, src.y)
            ctx.lineTo(tgt.x, tgt.y)
            ctx.strokeStyle = color
            ctx.lineWidth = 0.8 / globalScale
            ctx.setLineDash(isPerson2Person ? [4 / globalScale, 4 / globalScale] : [])
            ctx.stroke()
            ctx.setLineDash([])
          }}
          linkCanvasObjectMode={() => 'replace'}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
