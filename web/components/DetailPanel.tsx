'use client'
import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GraphNode, GraphEdge, VaultNote } from '@/lib/types'
import { NoteEditor } from './NoteEditor'

interface Props {
  node: GraphNode | null
  note: VaultNote | null
  allEdges: GraphEdge[]
  allNodes: GraphNode[]
  onNoteUpdated: () => void
  onNoteDeleted: () => void
  onNavigate: (id: string) => void
  width: number
  collapsed: boolean
  onToggleCollapse: () => void
}

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  person:   { bg: 'bg-blue-100 dark:bg-blue-500/15',    text: 'text-blue-700 dark:text-blue-400',   dot: 'bg-blue-500 dark:bg-blue-400' },
  project:  { bg: 'bg-emerald-100 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500 dark:bg-emerald-400' },
  idea:     { bg: 'bg-amber-100 dark:bg-amber-500/15',  text: 'text-amber-700 dark:text-amber-400',  dot: 'bg-amber-500 dark:bg-amber-400' },
  resource: { bg: 'bg-violet-100 dark:bg-violet-500/15', text: 'text-violet-700 dark:text-violet-400', dot: 'bg-violet-500 dark:bg-violet-400' },
  note:     { bg: 'bg-slate-100 dark:bg-slate-500/15',  text: 'text-slate-600 dark:text-slate-400',  dot: 'bg-slate-400' },
  meeting:  { bg: 'bg-cyan-100 dark:bg-cyan-500/15',    text: 'text-cyan-700 dark:text-cyan-400',    dot: 'bg-cyan-500 dark:bg-cyan-400' },
  daily:    { bg: 'bg-gray-100 dark:bg-gray-500/15',    text: 'text-gray-600 dark:text-gray-400',    dot: 'bg-gray-400' },
  area:     { bg: 'bg-pink-100 dark:bg-pink-500/15',    text: 'text-pink-700 dark:text-pink-400',    dot: 'bg-pink-500 dark:bg-pink-400' },
}

const TYPE_DOT: Record<string, string> = {
  person: 'bg-blue-400', project: 'bg-emerald-400', idea: 'bg-amber-400',
  resource: 'bg-violet-400', note: 'bg-slate-400', meeting: 'bg-cyan-400',
  daily: 'bg-gray-400', area: 'bg-pink-400',
}

export function DetailPanel({ node, note, allEdges, allNodes, onNoteUpdated, onNoteDeleted, onNavigate, width, collapsed, onToggleCollapse }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
  }, [note?.path])

  async function handleDelete() {
    if (!note) return
    setDeleting(true)
    try {
      const { sha } = await fetch(`/api/vault/note/${note.path}`).then(r => r.json())
      await fetch(`/api/vault/note/${note.path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha }),
      })
      onNoteDeleted()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  // Collapsed strip: just shows the expand button
  if (collapsed) {
    return (
      <aside
        className="w-10 border-l border-slate-200 dark:border-gray-800/60 bg-white dark:bg-gray-950 shrink-0 flex flex-col items-center pt-3 gap-2"
      >
        <button
          onClick={onToggleCollapse}
          title="Expand panel"
          className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          {/* chevron left (expand = show panel on right) */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </aside>
    )
  }

  const outgoing = allEdges.filter(e => e.source === node?.id)
  const incoming = allEdges.filter(e => e.target === node?.id)
  const nodeById = Object.fromEntries(allNodes.map(n => [n.id, n]))
  const typeColors = note ? (TYPE_COLORS[note.type] ?? TYPE_COLORS.note) : TYPE_COLORS.note

  return (
    <aside
      style={{ width }}
      className="relative border-l border-slate-200 dark:border-gray-800/60 overflow-y-auto flex flex-col bg-white dark:bg-gray-950 shrink-0"
    >
      {/* Empty state */}
      {(!node || !note) && (
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Collapse button top-right */}
          <div className="absolute top-0 right-0 pt-3 pr-3">
            <CollapseButton onToggle={onToggleCollapse} />
          </div>
          <div className="text-center px-6">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400 dark:text-gray-600">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-600">Select a node to view details</p>
          </div>
        </div>
      )}

      {/* Note content */}
      {node && note && (
        <>
          {/* Header */}
          <div className="p-5 border-b border-slate-100 dark:border-gray-800/60 flex items-start justify-between gap-3 sticky top-0 bg-white dark:bg-gray-950 z-10">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight mb-2">{note.title}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${typeColors.bg} ${typeColors.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${typeColors.dot}`} />
                  {note.type}
                </span>
                {note.date && (
                  <span className="text-xs text-slate-400 dark:text-gray-600">{note.date}</span>
                )}
              </div>
              {note.tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {note.tags.map(t => (
                    <span key={t} className="text-xs bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setEditing(e => !e)}
                className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:border-slate-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-150 cursor-pointer"
              >
                {editing ? 'View' : 'Edit'}
              </button>
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs px-2.5 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {deleting ? '…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete note"
                  className="p-1.5 rounded-md text-slate-400 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
              <CollapseButton onToggle={onToggleCollapse} />
            </div>
          </div>

          {/* Content */}
          {editing ? (
            <NoteEditor
              note={note}
              onSaved={() => {
                setEditing(false)
                onNoteUpdated()
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-4">
                {note.content ? (
                  <div className="prose-brain">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {note.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-gray-600 italic">Empty note</p>
                )}
              </div>

              {(outgoing.length > 0 || incoming.length > 0) && (
                <div className="border-t border-slate-100 dark:border-gray-800/60 px-5 py-4 space-y-4">
                  {outgoing.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">Links to</h3>
                      <ul className="space-y-0.5">
                        {outgoing.map(e => {
                          const dot = TYPE_DOT[nodeById[e.target]?.type] ?? 'bg-slate-400'
                          return (
                            <li key={`${e.source}-${e.target}`}>
                              <button onClick={() => onNavigate(e.target)} className="group flex items-center gap-2 w-full text-left py-1 cursor-pointer">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                                <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors truncate flex-1">
                                  {nodeById[e.target]?.title ?? e.target}
                                </span>
                                {e.typed && <span className="text-xs text-orange-500/70 shrink-0">{e.relationType}</span>}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                  {incoming.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">Linked from</h3>
                      <ul className="space-y-0.5">
                        {incoming.map(e => {
                          const dot = TYPE_DOT[nodeById[e.source]?.type] ?? 'bg-slate-400'
                          return (
                            <li key={`${e.source}-${e.target}`}>
                              <button onClick={() => onNavigate(e.source)} className="group flex items-center gap-2 w-full text-left py-1 cursor-pointer">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                                <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors truncate">
                                  {nodeById[e.source]?.title ?? e.source}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}

function CollapseButton({ onToggle }: { onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title="Collapse panel"
      className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
    >
      {/* chevron right (collapse = push panel away) */}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  )
}
