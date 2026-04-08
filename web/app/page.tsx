'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { VaultGraph, GraphNode, VaultNote } from '@/lib/types'
import { BrainGraph, TYPE_COLORS } from '@/components/BrainGraph'
import { DetailPanel } from '@/components/DetailPanel'
import { SearchBar } from '@/components/SearchBar'
import { NewNoteModal } from '@/components/NewNoteModal'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SettingsModal } from '@/components/SettingsModal'

function McpStatus() {
  const [isLocal, setIsLocal] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    const host = window.location.hostname
    setIsLocal(host === 'localhost' || host === '127.0.0.1')
  }, [])

  return (
    <div className="relative">
      <button
        onClick={() => setShowTooltip(v => !v)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
          isLocal
            ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isLocal ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        MCP {isLocal ? 'Offline' : 'Active'}
      </button>
      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 rounded-lg bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-lg z-50 text-left">
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-800 border-l border-t border-slate-200 dark:border-gray-700" />
          {isLocal ? (
            <>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">MCP not available</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                The MCP server requires a public URL with OAuth authentication. Deploy this app (e.g. on Vercel) to enable MCP integration with Claude Desktop and other AI tools.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">MCP active</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Your Superbrain is accessible via MCP. AI tools like Claude Desktop can read and search your vault through the remote MCP endpoint.
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                URL: <code className="text-[10px] bg-slate-100 dark:bg-gray-700 px-1 py-0.5 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/mcp</code>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 700
const DEFAULT_PANEL_WIDTH = MAX_PANEL_WIDTH

export default function BrainPage() {
  const [graph, setGraph] = useState<VaultGraph | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vaultError, setVaultError] = useState<'not_configured' | 'unreachable' | 'empty' | null>(null)
  const [vaultErrorMessage, setVaultErrorMessage] = useState<string | null>(null)
  const [showNewNote, setShowNewNote] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())
  const [showSystemNodes, setShowSystemNodes] = useState(false)

  // Panel resize & collapse
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [panelCollapsed, setPanelCollapsed] = useState(true)
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
    setVaultError(null)
    setVaultErrorMessage(null)
    try {
      const res = await fetch('/api/vault/graph')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'vault_not_configured') {
          setVaultError('not_configured')
          return
        }
        if (body.error === 'vault_unreachable') {
          setVaultError('unreachable')
          setVaultErrorMessage(body.message ?? null)
          return
        }
        if (body.error === 'vault_empty') {
          setVaultError('empty')
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const data: VaultGraph = await res.json()
      setGraph(data)

      // Check sync status once on load
      fetch('/api/vault/sync')
        .then(r => r.json())
        .then(data => { syncEnabledRef.current = data.syncEnabled ?? false })
        .catch(() => {})

      // Seed the hash so polling doesn't immediately re-fetch
      fetch('/api/vault/hash')
        .then(r => r.json())
        .then(({ hash }) => { if (hash) vaultHashRef.current = hash })
        .catch(() => {})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load graph')
    } finally {
      setLoading(false)
    }
  }

  async function handleNoteCreated(path: string) {
    setShowNewNote(false)
    await loadGraph()
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
  }

  // Silent background reload — no loading spinner
  const vaultHashRef = useRef<string | null>(null)
  const syncEnabledRef = useRef(false)

  async function refreshGraphSilently() {
    try {
      if (syncEnabledRef.current) {
        // Sync mode: call the sync endpoint which handles both directions
        const syncRes = await fetch('/api/vault/sync', { method: 'POST' })
        if (!syncRes.ok) return
        const syncData = await syncRes.json()
        // Reload graph if anything changed
        if (syncData.pushed > 0 || syncData.pulled > 0 || syncData.deleted > 0 || syncData.conflicts > 0) {
          const graphRes = await fetch('/api/vault/graph')
          if (!graphRes.ok) return
          const data: VaultGraph = await graphRes.json()
          setGraph(data)
          setVaultError(null)
          setError(null)
        }
        return
      }

      // Hash-based polling for non-sync mode
      const res = await fetch('/api/vault/hash')
      if (!res.ok) return
      const { hash } = await res.json()
      if (!hash || hash === vaultHashRef.current) return
      vaultHashRef.current = hash

      const graphRes = await fetch('/api/vault/graph')
      if (!graphRes.ok) return
      const data: VaultGraph = await graphRes.json()
      setGraph(data)
      setVaultError(null)
      setError(null)
    } catch {
      // Silent — don't disrupt the UI
    }
  }

  useEffect(() => { loadGraph() }, [])

  // Poll vault hash every 5 seconds for background updates
  useEffect(() => {
    if (vaultError || error) return
    const id = setInterval(refreshGraphSilently, 5000)
    return () => clearInterval(id)
  }, [vaultError, error])

  // Escape key deselects
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  if (vaultError) {
    const titles: Record<string, string> = {
      not_configured: 'No vault configured',
      unreachable: 'Vault not reachable',
      empty: 'Empty vault',
    }
    const descriptions: Record<string, string> = {
      not_configured: 'Set up a GitHub repository or local vault path to get started.',
      unreachable: vaultErrorMessage ?? 'The configured vault could not be reached. Check your settings or try again.',
      empty: 'This folder has no markdown files yet. Initialize it as a new vault or choose a different folder.',
    }

    async function handleInit() {
      setLoading(true)
      const res = await fetch('/api/vault/init', { method: 'POST' })
      if (res.ok) {
        await loadGraph()
      } else {
        setLoading(false)
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950">
        <div className="max-w-sm w-full mx-4 space-y-5 text-center">
          <div className={`w-12 h-12 mx-auto rounded-xl flex items-center justify-center ${
            vaultError === 'empty'
              ? 'bg-teal-100 dark:bg-teal-500/15'
              : 'bg-amber-100 dark:bg-amber-500/15'
          }`}>
            {vaultError === 'empty' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-600 dark:text-teal-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 dark:text-amber-400">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              {titles[vaultError]}
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-500 leading-relaxed">
              {descriptions[vaultError]}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {vaultError === 'empty' && (
              <button
                onClick={handleInit}
                className="w-full px-4 py-2.5 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors cursor-pointer"
              >
                Initialize vault
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className={`w-full px-4 py-2.5 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                vaultError === 'empty'
                  ? 'bg-slate-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-slate-300 dark:hover:bg-gray-700'
                  : 'bg-teal-600 text-white hover:bg-teal-500'
              }`}
            >
              {vaultError === 'empty' ? 'Choose different folder' : 'Open Settings'}
            </button>
            {vaultError !== 'empty' && (
              <button
                onClick={loadGraph}
                className="w-full px-4 py-2.5 text-xs bg-slate-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-md font-medium hover:bg-slate-300 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        </div>
        {showSettings && (
          <SettingsModal onClose={() => {
            setShowSettings(false)
            fetch('/api/vault/sync').then(r => r.json().catch(() => null)).then(d => { if (d) syncEnabledRef.current = d.syncEnabled ?? false }).catch(() => {})
            loadGraph()
          }} />
        )}
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

  const allNodes = showSystemNodes
    ? graph.nodes.filter(n => n.type === 'system' || n.type === 'template')
    : graph.nodes.filter(n => n.type !== 'system' && n.type !== 'template')
  const allEdges = graph.edges.filter(e =>
    allNodes.some(n => n.id === e.source) && allNodes.some(n => n.id === e.target)
  )

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

  const displayNodes = allNodes
  const displayEdges = allEdges

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-gray-950 text-gray-900 dark:text-slate-100" onClick={() => setSelectedId(null)}>
      <header className="relative z-20 flex items-center gap-4 px-5 py-2.5 border-b border-slate-200 dark:border-gray-800/60 shrink-0 bg-white dark:bg-gray-950/95 backdrop-blur-sm">
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

        <McpStatus />

        <div className="ml-auto flex items-center gap-2">
          <SearchBar nodes={graph.nodes} onSelect={setSelectedId} />
          <button
            onClick={() => setShowNewNote(true)}
            className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors duration-150 cursor-pointer"
          >
            + New Note
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-xs rounded-md font-medium transition-all duration-150 flex items-center gap-1.5 cursor-pointer bg-slate-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Settings
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 min-h-0" onClick={e => e.stopPropagation()}>
        {/* Graph fills all remaining space — ResizeObserver in BrainGraph keeps it centered */}
        <main className="flex-1 relative overflow-hidden min-w-0">
          <BrainGraph
            nodes={displayNodes}
            edges={displayEdges}
            selectedId={selectedId}
            onSelectNode={setSelectedId}
            activeTypes={activeTypes}
          />

          {/* System files toggle — top right */}
          <button
            onClick={() => { setShowSystemNodes(v => !v); setActiveTypes(new Set()); setSelectedId(null) }}
            title={showSystemNodes ? 'Switch to notes' : 'Switch to system files'}
            className={`absolute top-3 right-3 z-10 pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer border backdrop-blur-sm ${
              showSystemNodes
                ? 'bg-white/90 dark:bg-gray-900/90 text-gray-600 dark:text-gray-300 border-gray-200/80 dark:border-gray-700/80 shadow-sm'
                : 'bg-white/40 dark:bg-gray-900/40 text-gray-400 dark:text-gray-600 border-gray-200/30 dark:border-gray-700/30'
            }`}
          >
            <span className="text-xs">System</span>
            {/* Toggle pill */}
            <span className={`relative inline-flex items-center h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ${
              showSystemNodes ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}>
              <span className={`absolute h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${
                showSystemNodes ? 'translate-x-3.5' : 'translate-x-0.5'
              }`} />
            </span>
          </button>

          {/* Type filter overlay — left */}
          <div className="absolute top-3 left-3 z-10 flex flex-nowrap gap-1.5 overflow-x-auto pointer-events-none pr-28" style={{ scrollbarWidth: 'none' }}>
            {availableTypes.filter(t => showSystemNodes ? (t === 'system' || t === 'template') : (t !== 'system' && t !== 'template')).map(type => {
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
          onNoteDeleted={() => { setSelectedId(null); loadGraph() }}
          onNavigate={setSelectedId}
          width={panelWidth}
          collapsed={panelCollapsed}
          onToggleCollapse={togglePanel}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>

      {showSettings && (
        <SettingsModal onClose={() => {
          setShowSettings(false)
          fetch('/api/vault/sync').then(r => r.json().catch(() => null)).then(d => { if (d) syncEnabledRef.current = d.syncEnabled ?? false }).catch(() => {})
        }} />
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
