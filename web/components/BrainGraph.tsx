'use client'
import dynamic from 'next/dynamic'
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
  const graphData = {
    nodes: nodes.map(n => ({
      ...n,
      color: selectedId === n.id ? '#ffffff' : (TYPE_COLORS[n.type] ?? '#94a3b8'),
    })),
    links: edges.map(e => ({
      source: e.source,
      target: e.target,
      color: e.typed ? '#f97316' : '#374151',
      label: e.relationType,
    })),
  }

  return (
    <ForceGraph2D
      graphData={graphData}
      nodeLabel="title"
      nodeRelSize={6}
      linkDirectionalArrowLength={4}
      linkDirectionalArrowRelPos={1}
      onNodeClick={(node: any) => onSelectNode(node.id as string)}
      backgroundColor="#030712"
      linkColor={(link: any) => link.color as string}
      nodeColor={(node: any) => node.color as string}
    />
  )
}
