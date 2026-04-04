'use client'
import { useState } from 'react'
import { GraphNode, GraphEdge, VaultNote } from '@/lib/types'
import { NoteEditor } from './NoteEditor'

interface Props {
  node: GraphNode | null
  note: VaultNote | null
  allEdges: GraphEdge[]
  allNodes: GraphNode[]
  onNoteUpdated: () => void
  onNavigate: (id: string) => void
}

export function DetailPanel({ node, note, allEdges, allNodes, onNoteUpdated, onNavigate }: Props) {
  const [editing, setEditing] = useState(false)

  // Reset to view mode when the selected note changes
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  if (note?.path !== currentPath) {
    setCurrentPath(note?.path ?? null)
    if (editing) setEditing(false)
  }

  if (!node || !note) {
    return (
      <aside className="w-96 border-l border-gray-800 p-6 text-gray-500 flex items-center justify-center text-sm">
        Select a node to view details
      </aside>
    )
  }

  const outgoing = allEdges.filter(e => e.source === node.id)
  const incoming = allEdges.filter(e => e.target === node.id)
  const nodeById = Object.fromEntries(allNodes.map(n => [n.id, n]))

  return (
    <aside className="w-96 border-l border-gray-800 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-800 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">{note.title}</h2>
          <span className="text-xs text-gray-400 uppercase tracking-wide">{note.type}</span>
          {note.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {note.tags.map(t => (
                <span key={t} className="text-xs bg-gray-800 px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}
          {note.date && (
            <span className="text-xs text-gray-500 mt-1 block">{note.date}</span>
          )}
        </div>
        <button
          onClick={() => setEditing(e => !e)}
          className="shrink-0 text-sm px-3 py-1.5 rounded border border-gray-700 hover:border-gray-400 transition"
        >
          {editing ? 'View' : 'Edit'}
        </button>
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
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Note body */}
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">
            {note.content || <span className="text-gray-600 italic">Empty note</span>}
          </div>

          {/* Outgoing links */}
          {outgoing.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Links to
              </h3>
              <ul className="space-y-1">
                {outgoing.map(e => (
                  <li key={`${e.source}-${e.target}`}>
                    <button
                      onClick={() => onNavigate(e.target)}
                      className="text-sm text-blue-400 hover:underline flex items-center gap-2 w-full text-left"
                    >
                      <span className="truncate">
                        {nodeById[e.target]?.title ?? e.target}
                      </span>
                      {e.typed && (
                        <span className="text-xs text-orange-400 shrink-0">
                          {e.relationType}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Incoming links */}
          {incoming.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Linked from
              </h3>
              <ul className="space-y-1">
                {incoming.map(e => (
                  <li key={`${e.source}-${e.target}`}>
                    <button
                      onClick={() => onNavigate(e.source)}
                      className="text-sm text-blue-400 hover:underline w-full text-left truncate"
                    >
                      {nodeById[e.source]?.title ?? e.source}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outgoing.length === 0 && incoming.length === 0 && (
            <p className="text-sm text-gray-600 italic">No links</p>
          )}
        </div>
      )}
    </aside>
  )
}
