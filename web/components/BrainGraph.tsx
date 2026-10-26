'use client'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import SpriteText from 'three-spritetext'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import { GraphNode, GraphEdge } from '@/lib/types'

// Loaded in the browser only (WebGL); the cast keeps the component's generic node and link types
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false }) as unknown as typeof import('react-force-graph-3d').default

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

// A node with at least this many links always shows its label
const HUB_DEGREE = 6
// How far the camera stays from a node it flies to
const FOCUS_DISTANCE = 90
const FLY_MS = 900

type Node3D = GraphNode & { color: string; degree: number; x?: number; y?: number; z?: number }
type Link3D = { source: string | Node3D; target: string | Node3D; typed: boolean }

const idOf = (end: string | Node3D) => (typeof end === 'string' ? end : end.id)

function truncate(s: string, max = 28): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/** Pulls every node gently toward the middle, so notes without links don't drift off into space. */
function centerGravity(strength = 0.02) {
  let simNodes: { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }[] = []
  function force() {
    for (const n of simNodes) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * strength
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * strength
      n.vz = (n.vz ?? 0) - (n.z ?? 0) * strength
    }
  }
  force.initialize = (nodes: typeof simNodes) => { simNodes = nodes }
  return force
}

/** A sphere of faint points far behind the graph, for depth. */
function makeStarfield(dark: boolean): THREE.Points {
  const count = 1200
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Uniform on a thick spherical shell
    const r = 1400 + Math.random() * 1600
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: dark ? 0x8fb3ff : 0x64748b,
    size: 1.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: dark ? 0.35 : 0.25,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'starfield'
  return points
}

export function BrainGraph({ nodes, edges, selectedId, onSelectNode, activeTypes, typeColors }: Props) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const background = isDark ? '#020617' : '#eef2f7'
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<Node3D, Link3D> | undefined>(undefined)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const fitted = useRef(0)
  const lastFit = useRef(0)
  const settled = useRef(false)
  const bloomRef = useRef<{ enabled: boolean; setSize: (w: number, h: number) => void } | null>(null)

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
    for (const e of edges) {
      map[e.source] = (map[e.source] ?? 0) + 1
      map[e.target] = (map[e.target] ?? 0) + 1
    }
    return map
  }, [edges])

  const neighborsOf = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const n of nodes) map[n.id] = new Set()
    for (const e of edges) {
      map[e.source]?.add(e.target)
      map[e.target]?.add(e.source)
    }
    return map
  }, [nodes, edges])

  const graphData = useMemo(() => ({
    nodes: nodes.map((n): Node3D => ({ ...n, color: typeColors[n.type] ?? '#94a3b8', degree: degreeById[n.id] ?? 0 })),
    links: edges.map((e): Link3D => ({ source: e.source, target: e.target, typed: e.typed })),
  }), [nodes, edges, degreeById, typeColors])

  const focusId = hoveredId ?? selectedId
  const focusSet = useMemo(() => {
    if (!focusId) return null
    return new Set([focusId, ...(neighborsOf[focusId] ?? [])])
  }, [focusId, neighborsOf])

  const isDimmed = (node: Node3D) =>
    focusSet ? !focusSet.has(node.id) : activeTypes.size > 0 && !activeTypes.has(node.type)

  // Scene extras, once the graph exists: starfield, bloom, slow auto-rotation
  useEffect(() => {
    if (!size) return
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>

    async function setup() {
      const fg = graphRef.current
      if (!fg) {
        if (++attempts < 50) timer = setTimeout(setup, 100)
        return
      }
      const scene = fg.scene()
      scene.getObjectByName('starfield')?.removeFromParent()
      scene.add(makeStarfield(isDark))
      // The background belongs to the scene, not the renderer's clear colour: the bloom pass resets
      // the clear colour in the wrong colour space, which turned the background a washed-out blue
      scene.background = new THREE.Color(background)

      if (!bloomRef.current) {
        const [{ UnrealBloomPass }, { OutputPass }] = await Promise.all([
          import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
          import('three/examples/jsm/postprocessing/OutputPass.js'),
        ])
        if (cancelled) return
        // Only bright things glow (threshold), so the background and the faint stars stay dark
        const bloom = new UnrealBloomPass(new THREE.Vector2(size!.width, size!.height), 0.8, 0.4, 0.35)
        fg.postProcessingComposer().addPass(bloom)
        // Converts the composed image to the screen's colour space once, as the last step
        fg.postProcessingComposer().addPass(new OutputPass())
        bloomRef.current = bloom
      }
      // Bloom washes out on a light background, so it only glows in the dark
      bloomRef.current.enabled = isDark

      const controls = fg.controls() as { autoRotate?: boolean; autoRotateSpeed?: number }
      controls.autoRotateSpeed = 0.35

      // More room between nodes than the default, so the cloud reads as a structure, not a knot
      fg.d3Force('charge')?.strength(-90)
      fg.d3Force('link')?.distance(36)
      fg.d3Force('centerGravity', centerGravity(0.012))
    }
    setup()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [size, isDark, background])

  useEffect(() => {
    if (size) bloomRef.current?.setSize(size.width, size.height)
  }, [size])

  // Drift slowly while nothing is selected; hold still while you look at a note
  useEffect(() => {
    const controls = graphRef.current?.controls() as { autoRotate?: boolean } | undefined
    if (controls) controls.autoRotate = !selectedId
  }, [selectedId, ready])

  // Fly to the selected note
  useEffect(() => {
    const fg = graphRef.current
    if (!selectedId || !fg) return
    const node = graphData.nodes.find(n => n.id === selectedId)
    if (node?.x == null || node.y == null || node.z == null) return
    const dist = Math.hypot(node.x, node.y, node.z) || 1
    const ratio = 1 + FOCUS_DISTANCE / dist
    fg.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      { x: node.x, y: node.y, z: node.z },
      FLY_MS,
    )
  }, [selectedId, graphData])

  const labelColor = isDark ? '#e2e8f0' : '#1e293b'

  return (
    <div
      ref={containerRef}
      className="w-full h-full transition-opacity duration-700 ease-out"
      style={{ opacity: ready ? 1 : 0, cursor: hoveredId ? 'pointer' : 'grab', background }}
    >
      {size && (
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor={background}
          showNavInfo={false}
          controlType="orbit"
          warmupTicks={80}
          cooldownTicks={120}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.4}
          onEngineTick={() => {
            // Keep the graph framed while the first layout unfolds (a few seconds), then leave the camera be
            if (settled.current) return
            const now = performance.now()
            if (!fitted.current) fitted.current = now
            if (now - lastFit.current < 900 || now - fitted.current > 5000) return
            lastFit.current = now
            if (!selectedId) graphRef.current?.zoomToFit(700, 30)
            setReady(true)
          }}
          onEngineStop={() => {
            // Frame the settled layout once; after that the camera is yours
            if (settled.current) return
            settled.current = true
            if (!selectedId) graphRef.current?.zoomToFit(600, 30)
          }}
          nodeLabel={() => ''}
          nodeThreeObject={(node: Node3D) => {
            const dimmed = isDimmed(node)
            const selected = node.id === selectedId
            const radius = 2.6 + Math.min(node.degree, 20) * 0.45
            const group = new THREE.Group()

            const core = new THREE.Mesh(
              new THREE.SphereGeometry(radius, 20, 14),
              new THREE.MeshBasicMaterial({
                color: node.color,
                transparent: true,
                opacity: dimmed ? 0.12 : 0.9,
              }),
            )
            group.add(core)

            // A soft halo around the selected note; the bloom turns it into a glow
            if (selected) {
              const halo = new THREE.Mesh(
                new THREE.SphereGeometry(radius * 2.2, 16, 12),
                new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: 0.2, depthWrite: false }),
              )
              group.add(halo)
            }

            // A ring marks the selected note
            if (selected) {
              const ring = new THREE.Mesh(
                new THREE.TorusGeometry(radius * 2.6, 0.35, 8, 48),
                new THREE.MeshBasicMaterial({ color: isDark ? 0xffffff : 0x0f766e, transparent: true, opacity: 0.85 }),
              )
              group.add(ring)
            }

            const showLabel = !dimmed && (node.degree >= HUB_DEGREE || (focusSet?.has(node.id) ?? false))
            if (showLabel) {
              const label = new SpriteText(truncate(node.title), selected ? 5 : 3.6, labelColor)
              label.fontFace = 'Geist, -apple-system, BlinkMacSystemFont, sans-serif'
              label.fontWeight = selected ? '600' : '500'
              label.material.depthWrite = false
              label.position.set(0, radius * 2 + 4, 0)
              group.add(label)
            }
            return group
          }}
          linkColor={(link: Link3D) => {
            const s = idOf(link.source)
            const t = idOf(link.target)
            const lit = focusSet ? focusSet.has(s) && focusSet.has(t) && (s === focusId || t === focusId) : true
            if (!lit) return isDark ? '#0f172a' : '#e2e8f0'
            if (focusSet) return isDark ? '#a5f3fc' : '#0e7490'
            return link.typed ? (isDark ? '#0ea5e9' : '#0e7490') : (isDark ? '#1e3a5f' : '#94a3b8')
          }}
          linkOpacity={isDark ? 0.3 : 0.45}
          linkWidth={(link: Link3D) => (focusId && (idOf(link.source) === focusId || idOf(link.target) === focusId) ? 0.8 : 0)}
          // Light travels along the links: a little everywhere, more around the note you look at
          linkDirectionalParticles={(link: Link3D) =>
            focusId ? (idOf(link.source) === focusId || idOf(link.target) === focusId ? 4 : 0) : 1}
          linkDirectionalParticleSpeed={(link: Link3D) => (focusId ? 0.008 : 0.003) + (link.typed ? 0.002 : 0)}
          linkDirectionalParticleWidth={(link: Link3D) => (focusId ? 1.6 : 0.9) + (link.typed ? 0.3 : 0)}
          linkDirectionalParticleColor={(link: Link3D) => {
            const src = typeof link.source === 'string' ? undefined : link.source
            return src?.color ?? '#7dd3fc'
          }}
          onNodeHover={(node: Node3D | null) => setHoveredId(node?.id ?? null)}
          onNodeClick={(node: Node3D) => onSelectNode(node.id)}
          onBackgroundClick={() => onSelectNode(null)}
        />
      )}
    </div>
  )
}
