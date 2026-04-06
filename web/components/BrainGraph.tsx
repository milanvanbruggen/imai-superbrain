'use client'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useEffect, useState, useRef, useMemo } from 'react'
import * as THREE from 'three'
import { GraphNode, GraphEdge } from '@/lib/types'

const ForceGraph3D = dynamic(
  () => import('react-force-graph-3d'),
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
  person:   '#60a5fa',
  project:  '#34d399',
  idea:     '#f59e0b',
  resource: '#a78bfa',
  note:     '#94a3b8',
  meeting:  '#06B6D4',
  daily:    '#6B7280',
  area:     '#EC4899',
}

const NODE_REL_SIZE = 3.5
const COLLIDE_DIST  = 20

function truncate(s: string, max = 22): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

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
  ;(force as any).initialize = (nodes: any[]) => { simNodes = nodes }
  return force
}

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

type NodeObjects = { sphere: THREE.Mesh; halo: THREE.Mesh; label: any }

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const nodeObjectsRef = useRef<Map<string, NodeObjects>>(new Map())

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

  const neighborsOf = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    nodes.forEach(n => { map[n.id] = new Set() })
    edges.forEach(e => {
      map[e.source]?.add(e.target)
      map[e.target]?.add(e.source)
    })
    return map
  }, [nodes, edges])

  // Physics + camera setup
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

      // Lock camera top-down, disable rotation
      fg.cameraPosition({ x: 0, y: 0, z: 500 })
      const controls = fg.controls()
      if (controls) {
        controls.enableRotate = false
        controls.mouseButtons = {
          LEFT: 2,   // pan on left drag (THREE.MOUSE.PAN)
          MIDDLE: 1, // dolly on middle
          RIGHT: 2,
        }
      }
    }, 30)
    return () => clearTimeout(timer)
  }, [size, degreeById])

  const isDark = !mounted || resolvedTheme === 'dark'
  const bgColor = isDark ? '#030712' : '#f8fafc'
  const edgeColor      = isDark ? '#2d3748' : '#cbd5e1'
  const edgeColorFocus = isDark ? '#4b5563' : '#94a3b8'
  const labelColorDim    = isDark ? '#374151' : '#9ca3af'
  const labelColorActive = isDark ? '#d1d5db' : '#1f2937'

  const focusId = hoveredId ?? selectedId
  const focusNeighbors: Set<string> = focusId ? (neighborsOf[focusId] ?? new Set()) : new Set()

  function isNodeDimmed(nodeId: string, nodeType: string): boolean {
    if (focusId !== null) return nodeId !== focusId && !focusNeighbors.has(nodeId)
    if (activeTypes.size === 0) return false
    return !activeTypes.has(nodeType)
  }

  // Update Three.js material properties on focus/selection/hover changes
  useEffect(() => {
    nodeObjectsRef.current.forEach(({ sphere, halo, label }, nodeId) => {
      const mat = sphere.material as THREE.MeshLambertMaterial
      const nodeType = sphere.userData.type as string
      const dimmed = isNodeDimmed(nodeId, nodeType)
      const isFocused = nodeId === focusId || focusNeighbors.has(nodeId)
      const isSelected = nodeId === selectedId
      const isHovered  = nodeId === hoveredId

      mat.opacity = dimmed ? 0.08 : 1

      const haloMat = halo.material as THREE.MeshBasicMaterial
      haloMat.opacity = (isSelected || isHovered) ? 0.22 : 0

      if (label) {
        label.visible = isFocused || !focusId
        label.color = dimmed ? labelColorDim : isFocused ? labelColorActive : (isDark ? '#9ca3af' : '#6b7280')
        label.backgroundColor = 'transparent'
      }
    })
  })

  // Center camera on selected node
  useEffect(() => {
    if (!selectedId || !graphRef.current) return
    const node = graphData.nodes.find(n => n.id === selectedId) as any
    if (node?.x != null && node?.y != null) {
      const camZ = graphRef.current.camera().position.z
      graphRef.current.cameraPosition(
        { x: node.x, y: node.y, z: camZ },
        { x: node.x, y: node.y, z: 0 },
        400
      )
    }
  }, [selectedId])

  const graphData = useMemo(() => ({
    nodes: nodes.map(n => {
      const deg = degreeById[n.id] ?? 0
      return {
        ...n,
        color: TYPE_COLORS[n.type] ?? '#94a3b8',
        val: deg === 0 ? 0.4 : Math.min(0.6 + deg * 0.15, 3),
      }
    }),
    links: edges.map(e => ({ source: e.source, target: e.target, typed: e.typed })),
  }), [nodes, edges, degreeById])

  function nodeThreeObject(node: any): THREE.Object3D {
    const r = Math.sqrt(node.val as number) * NODE_REL_SIZE
    const color = node.color as string
    const nodeId = node.id as string

    const group = new THREE.Group()

    // Sphere with subtle Lambert shading — diffuse-only, no specular highlight
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 18),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 1,
      })
    )
    sphere.userData.type = node.type
    group.add(sphere)

    // Halo: slightly larger sphere rendered from inside for selection ring
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(r + 2.5, 24, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.BackSide,
      })
    )
    group.add(halo)

    // Label sprite
    let label: any = null
    if (typeof window !== 'undefined') {
      import('three-spritetext').then(mod => {
        const SpriteText = mod.default ?? mod
        const sprite = new SpriteText(truncate(node.title ?? nodeId))
        sprite.color = isDark ? '#9ca3af' : '#6b7280'
        sprite.textHeight = 3
        sprite.fontFace = '-apple-system, BlinkMacSystemFont, sans-serif'
        sprite.backgroundColor = 'transparent'
        sprite.position.set(0, -(r + 4), 0)
        group.add(sprite)
        nodeObjectsRef.current.set(nodeId, { sphere, halo, label: sprite })
      })
    }

    nodeObjectsRef.current.set(nodeId, { sphere, halo, label })
    return group
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {size && (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          numDimensions={2}
          nodeLabel=""
          nodeRelSize={NODE_REL_SIZE}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkDirectionalArrowLength={0}
          d3AlphaDecay={0.012}
          d3VelocityDecay={0.4}
          onNodeClick={(node: any) => onSelectNode(node.id as string)}
          onBackgroundClick={() => onSelectNode(null)}
          onNodeHover={(node: any) => setHoveredId(node?.id ?? null)}
          backgroundColor={bgColor}
          linkColor={(link: any) => {
            const src = link.source as any
            const tgt = link.target as any
            const srcId: string = src?.id ?? src
            const tgtId: string = tgt?.id ?? tgt
            const srcDimmed = isNodeDimmed(srcId, src?.type ?? '')
            const tgtDimmed = isNodeDimmed(tgtId, tgt?.type ?? '')

            if (focusId !== null) {
              if (srcDimmed && tgtDimmed) return isDark ? '#1a202c' : '#f8fafc'
              return srcDimmed || tgtDimmed ? edgeColor + '55' : edgeColorFocus
            }
            if (activeTypes.size > 0 && (srcDimmed || tgtDimmed)) {
              return isDark ? '#1e2533' : '#f1f5f9'
            }
            return edgeColor
          }}
          linkWidth={0.5}
          linkOpacity={0.8}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
