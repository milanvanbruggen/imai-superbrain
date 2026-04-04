'use client'
import { useState, useEffect } from 'react'
import { VaultGraph, GraphNode, VaultNote } from '@/lib/types'
import { BrainGraph } from '@/components/BrainGraph'
import { DetailPanel } from '@/components/DetailPanel'
import { SearchBar } from '@/components/SearchBar'

export default function BrainPage() {
  const [graph, setGraph] = useState<VaultGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadGraph() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/vault/graph')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: VaultGraph = await res.json()
      setGraph(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load graph')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGraph() }, [])

  const selectedNode = graph?.nodes.find(n => n.id === selectedId) ?? null
  const selectedNote = selectedId && graph ? (graph.notesByStem[selectedId] ?? null) : null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400 text-sm">
        Loading brain...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4">
        <p className="text-red-400 text-sm">Failed to load: {error}</p>
        <button
          onClick={loadGraph}
          className="px-4 py-2 bg-gray-800 text-sm rounded hover:bg-gray-700 transition"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!graph) return null

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
        <h1 className="text-sm font-semibold text-white tracking-wide">Superbrain</h1>
        <span className="text-xs text-gray-500">{graph.nodes.length} notes</span>
        <div className="ml-auto">
          <SearchBar nodes={graph.nodes} onSelect={setSelectedId} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 relative overflow-hidden">
          <BrainGraph
            nodes={graph.nodes}
            edges={graph.edges}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
          />
        </main>

        <DetailPanel
          node={selectedNode}
          note={selectedNote}
          allEdges={graph.edges}
          allNodes={graph.nodes}
          onNoteUpdated={loadGraph}
          onNavigate={setSelectedId}
        />
      </div>
    </div>
  )
}
