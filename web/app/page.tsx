'use client'
import { useState, useEffect } from 'react'
import { VaultGraph, GraphNode, VaultNote } from '@/lib/types'
import { BrainGraph } from '@/components/BrainGraph'
import { DetailPanel } from '@/components/DetailPanel'
import { SearchBar } from '@/components/SearchBar'
import { NewNoteModal } from '@/components/NewNoteModal'

export default function BrainPage() {
  const [graph, setGraph] = useState<VaultGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewNote, setShowNewNote] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [inboxFilter, setInboxFilter] = useState(false)

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

  async function handleNoteCreated(path: string) {
    setShowNewNote(false)
    await loadGraph()
    loadInboxCount()
    // Select the new note: stem is filename without extension
    const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
    setSelectedId(stem.toLowerCase())
  }

  async function handleNoteUpdated() {
    await loadGraph()
    loadInboxCount()
  }

  async function loadInboxCount() {
    try {
      const res = await fetch('/api/vault/inbox')
      if (res.ok) {
        const { count } = await res.json()
        setInboxCount(count)
      }
    } catch {
      // non-critical, ignore
    }
  }

  useEffect(() => { loadGraph(); loadInboxCount() }, [])

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

  const displayNodes = inboxFilter
    ? graph.nodes.filter(n => n.path.startsWith('inbox/'))
    : graph.nodes
  const displayEdges = inboxFilter
    ? graph.edges.filter(e => displayNodes.some(n => n.id === e.source))
    : graph.edges

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
        <h1 className="text-sm font-semibold text-white tracking-wide">Superbrain</h1>
        <span className="text-xs text-gray-500">{graph.nodes.length} notes</span>
        <div className="ml-auto flex items-center gap-3">
          <SearchBar nodes={graph.nodes} onSelect={setSelectedId} />
          <button
            onClick={() => setInboxFilter(f => !f)}
            className={`px-3 py-1.5 text-xs rounded font-medium transition flex items-center gap-1.5 ${
              inboxFilter
                ? 'bg-yellow-500 text-black'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Inbox
            {inboxCount > 0 && (
              <span className="bg-black text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {inboxCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowNewNote(true)}
            className="px-3 py-1.5 text-xs bg-white text-black rounded font-medium hover:bg-gray-200 transition"
          >
            + New Note
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 relative overflow-hidden">
          <BrainGraph
            nodes={displayNodes}
            edges={displayEdges}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
          />
        </main>

        <DetailPanel
          node={selectedNode}
          note={selectedNote}
          allEdges={graph.edges}
          allNodes={graph.nodes}
          onNoteUpdated={handleNoteUpdated}
          onNavigate={setSelectedId}
        />
      </div>
      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={handleNoteCreated}
        />
      )}
    </div>
  )
}
