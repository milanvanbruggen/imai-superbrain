'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { VaultGraph, GraphNode, VaultNote } from '@/lib/types'
import { BrainGraph, TYPE_COLORS } from '@/components/BrainGraph'
import { DetailPanel } from '@/components/DetailPanel'
import { SearchBar } from '@/components/SearchBar'
import { NewNoteModal } from '@/components/NewNoteModal'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SettingsModal } from '@/components/SettingsModal'

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 700
const DEFAULT_PANEL_WIDTH = MAX_PANEL_WIDTH

export default function BrainPage() {
  const [graph, setGraph] = useState<VaultGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewNote, setShowNewNote] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [inboxFilter, setInboxFilter] = useState(false)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())

  // Panel resize & collapse
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const prevWidthRef = useRef(DEFAULT_PANEL_WIDTH)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(DEFAULT_PANEL_WIDTH)

  const togglePanel = useCallback(() => {
    if (panelCollapsed) {
      setPanelCollapsed(false)
      setPanelWidth(prevWidthRef.current)
    } else {
      prevWidthRef.current = panelWidth
      setPanelCollapsed(true)
    }
  }, [panelCollapsed, panelWidth])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [panelWidth])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return
      const delta = dragStartX.current - e.clientX
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragStartWidth.current + delta))
      setPanelWidth(next)
    }
    function onMouseUp() {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

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
    const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
    setSelectedId(stem.toLowerCase())
    // Make sure panel is open when a note is created
    if (panelCollapsed) {
      setPanelCollapsed(false)
      setPanelWidth(prevWidthRef.current)
    }
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
      // non-critical
    }
  }

  useEffect(() => { loadGraph(); loadInboxCount() }, [])

  // Auto-expand panel when a node is selected
  useEffect(() => {
    if (selectedId && panelCollapsed) {
      setPanelCollapsed(false)
      setPanelWidth(prevWidthRef.current)
    }
  }, [selectedId])

  const selectedNode = graph?.nodes.find(n => n.id === selectedId) ?? null
  const selectedNote = selectedId && graph ? (graph.notesByStem[selectedId] ?? null) : null

  const availableTypes = useMemo(
    () => graph ? [...new Set(graph.nodes.map(n => n.type))].sort() : [],
    [graph]
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950">
        <div className="flex items-center gap-3 text-gray-400 dark:text-gray-500 text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          Loading brain...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4 bg-slate-50 dark:bg-gray-950">
        <p className="text-red-500 text-sm">Failed to load: {error}</p>
        <button
          onClick={loadGraph}
          className="px-4 py-2 bg-slate-200 dark:bg-gray-800 text-sm rounded-md hover:bg-slate-300 dark:hover:bg-gray-700 transition cursor-pointer text-gray-700 dark:text-gray-200"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!graph) return null

  const baseNodes = inboxFilter ? graph.nodes.filter(n => n.path.startsWith('inbox/')) : graph.nodes
  const baseEdges = inboxFilter ? graph.edges.filter(e => baseNodes.some(n => n.id === e.source)) : graph.edges

  function toggleType(type: string) {
    setActiveTypes(prev => {
      if (prev.size === 0) return new Set([type])
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
        return next.size === 0 ? new Set() : next
      }
      next.add(type)
      return next
    })
  }

  const displayNodes = baseNodes
  const displayEdges = baseEdges

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-gray-950 text-gray-900 dark:text-slate-100">
      <header className="flex items-center gap-4 px-5 py-2.5 border-b border-slate-200 dark:border-gray-800/60 shrink-0 bg-white dark:bg-gray-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <line x1="12" y1="2" x2="12" y2="6"/>
              <line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="6" y2="12"/>
              <line x1="18" y1="12" x2="22" y2="12"/>
            </svg>
          </div>
          <h1 className="text-sm font-semibold tracking-wide">Superbrain</h1>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-600 tabular-nums">{graph.nodes.length} notes</span>

        <div className="ml-auto flex items-center gap-2">
          <SearchBar nodes={graph.nodes} onSelect={setSelectedId} />
          <button
            onClick={() => setInboxFilter(f => !f)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
              inboxFilter
                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400/40'
                : 'bg-slate-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700'
            }`}
          >
            Inbox
            {inboxCount > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {inboxCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowNewNote(true)}
            className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors duration-150 cursor-pointer"
          >
            + New Note
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Vault settings"
            className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Graph fills all remaining space — ResizeObserver in BrainGraph keeps it centered */}
        <main className="flex-1 relative overflow-hidden min-w-0">
          <BrainGraph
            nodes={displayNodes}
            edges={displayEdges}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
            activeTypes={activeTypes}
          />

          {/* Type filter overlay */}
          <div className="absolute top-3 left-3 right-3 z-10 flex flex-nowrap gap-1.5 overflow-x-auto pointer-events-none" style={{ scrollbarWidth: 'none' }}>
            {availableTypes.map(type => {
              const isActive = activeTypes.size === 0 || activeTypes.has(type)
              const color = TYPE_COLORS[type] ?? '#94a3b8'
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  title={isActive ? `Hide ${type}` : `Show only ${type}`}
                  className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer border backdrop-blur-sm ${
                    isActive
                      ? 'bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200 border-gray-200/80 dark:border-gray-700/80 shadow-sm'
                      : 'bg-white/40 dark:bg-gray-900/40 text-gray-400 dark:text-gray-600 border-gray-200/30 dark:border-gray-700/30'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: isActive ? color : '#9ca3af' }}
                  />
                  {type}
                </button>
              )
            })}
          </div>
        </main>

        {/* Drag handle — hidden when panel is collapsed */}
        {!panelCollapsed && (
          <div
            onMouseDown={onDragStart}
            className="w-1 cursor-col-resize shrink-0 bg-slate-200 dark:bg-gray-800/60 hover:bg-teal-400 dark:hover:bg-teal-600 transition-colors duration-150"
            title="Drag to resize"
          />
        )}

        <DetailPanel
          node={selectedNode}
          note={selectedNote}
          allEdges={graph.edges}
          allNodes={graph.nodes}
          onNoteUpdated={handleNoteUpdated}
          onNavigate={setSelectedId}
          width={panelWidth}
          collapsed={panelCollapsed}
          onToggleCollapse={togglePanel}
        />
      </div>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
      {showNewNote && (
        <NewNoteModal
          onClose={() => setShowNewNote(false)}
          onCreated={handleNoteCreated}
        />
      )}
    </div>
  )
}
