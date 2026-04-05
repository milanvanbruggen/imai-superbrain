'use client'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useEffect, useState, useRef } from 'react'
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
}

const TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa',
  project: '#34d399',
  idea: '#f59e0b',
  resource: '#a78bfa',
  note: '#94a3b8',
  meeting: '#06B6D4',
  daily: '#6B7280',
  area: '#EC4899',
}

export function BrainGraph({ nodes, edges, selectedId, onSelectNode }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
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

  const isDark = !mounted || resolvedTheme === 'dark'
  const bgColor = isDark ? '#030712' : '#f8fafc'
  const linkColor = isDark ? '#374151' : '#cbd5e1'
  const selectedColor = isDark ? '#ffffff' : '#0f172a'

  const graphData = {
    nodes: nodes.map(n => ({
      ...n,
      color: selectedId === n.id ? selectedColor : (TYPE_COLORS[n.type] ?? '#94a3b8'),
    })),
    links: edges.map(e => ({
      source: e.source,
      target: e.target,
      color: e.typed ? '#f97316' : linkColor,
      label: e.relationType,
    })),
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {size && (
        <ForceGraph2D
          graphData={graphData}
          nodeLabel="title"
          nodeRelSize={6}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(node: any) => onSelectNode(node.id as string)}
          backgroundColor={bgColor}
          linkColor={(link: any) => link.color as string}
          nodeColor={(node: any) => node.color as string}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  )
}
