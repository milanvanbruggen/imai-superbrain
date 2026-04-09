'use client'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GraphNode, GraphEdge, VaultNote } from '@/lib/types'
import { NoteEditor } from './NoteEditor'
import { useSession } from 'next-auth/react'
import { GmailModal } from './GmailModal'

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
  onOpenSettings?: () => void
  noteTypes: { name: string; color: string }[]
  typeColors: Record<string, string>
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
  group:    { bg: 'bg-orange-100 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500 dark:bg-orange-400' },
  system:   { bg: 'bg-gray-100 dark:bg-gray-500/15',    text: 'text-gray-600 dark:text-gray-400',    dot: 'bg-gray-400' },
  template: { bg: 'bg-purple-100 dark:bg-purple-500/15', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500 dark:bg-purple-400' },
}

const TYPE_DOT: Record<string, string> = {
  person: 'bg-blue-400', project: 'bg-emerald-400', idea: 'bg-amber-400',
  resource: 'bg-violet-400', note: 'bg-slate-400', meeting: 'bg-cyan-400',
  daily: 'bg-gray-400', area: 'bg-pink-400', group: 'bg-orange-400',
  system: 'bg-gray-400', template: 'bg-purple-400',
}

export function DetailPanel({ node, note, allEdges, allNodes, onNoteUpdated, onNoteDeleted, onNavigate, width, collapsed, onToggleCollapse, onOpenSettings, noteTypes, typeColors }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [saving, setSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const typePickerRef = useRef<HTMLDivElement>(null)
  const { data: session } = useSession()
  const [gmailOpen, setGmailOpen] = useState(false)
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const [settingType, setSettingType] = useState(false)
  const [removingLink, setRemovingLink] = useState<string | null>(null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [pickerType, setPickerType] = useState('')
  const [pickerTarget, setPickerTarget] = useState('')
  const [pickerRelationType, setPickerRelationType] = useState('')
  const [addingLink, setAddingLink] = useState(false)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
    setRenaming(false)
    setTypePickerOpen(false)
    setSettingType(false)
    setLinkPickerOpen(false)
    setPickerType('')
    setPickerTarget('')
    setPickerRelationType('')
  }, [note?.path])

  useEffect(() => {
    if (renaming) renameInputRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (!typePickerOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTypePickerOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [typePickerOpen])

  useEffect(() => {
    if (!typePickerOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (typePickerRef.current && !typePickerRef.current.contains(e.target as Node)) {
        setTypePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [typePickerOpen])

  async function handleRename() {
    if (!note || !renameValue.trim() || renameValue.trim() === note.title) {
      setRenaming(false)
      return
    }
    setSaving(true)
    try {
      await fetch(`/api/vault/note/${note.path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      })
      onNoteUpdated()
    } finally {
      setSaving(false)
      setRenaming(false)
    }
  }

  async function handleSetType(type: string) {
    if (!note || settingType) return
    setSettingType(true)
    try {
      const res = await fetch(`/api/vault/note/${note.path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'set-type', type }),
      })
      if (res.ok) onNoteUpdated()
    } finally {
      setSettingType(false)
      setTypePickerOpen(false)
    }
  }

  async function handleRemoveRelation(target: string) {
    if (!note || removingLink) return
    setRemovingLink(target)
    try {
      const res = await fetch(`/api/vault/note/${note.path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'remove-relation', target }),
      })
      if (res.ok) onNoteUpdated()
    } finally {
      setRemovingLink(null)
    }
  }

  async function handleAddRelation() {
    if (!note || !pickerTarget || addingLink) return
    setAddingLink(true)
    try {
      const res = await fetch(`/api/vault/note/${note.path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'add-relation',
          target: pickerTarget,
          relationType: pickerRelationType || null,
        }),
      })
      if (res.ok) {
        onNoteUpdated()
        setLinkPickerOpen(false)
        setPickerTarget('')
        setPickerRelationType('')
      }
    } finally {
      setAddingLink(false)
    }
  }

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
  const relationTargets = new Set(note ? note.relations.map(r => r.target.toLowerCase()) : [])
  const managedLower = new Set(note ? note.managedLinks.map(s => s.toLowerCase()) : [])
  const untypedManaged = note ? note.managedLinks.filter(s => !relationTargets.has(s.toLowerCase())) : []
  const organicLinks = note ? note.wikilinks.filter(s => !managedLower.has(s.toLowerCase()) && !relationTargets.has(s.toLowerCase())) : []
  const linkedStems = new Set([...Array.from(relationTargets), ...Array.from(managedLower)])
  const pickerTypes = [...new Set(allNodes.filter(n => n.id !== node?.id).map(n => n.type))].sort()
  const pickerNotes = allNodes.filter(n =>
    n.type === pickerType &&
    n.id !== node?.id &&
    !linkedStems.has(n.id)
  )
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
              {renaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                  onBlur={handleRename}
                  disabled={saving}
                  className="w-full text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight mb-2 bg-slate-100 dark:bg-gray-800 border border-slate-300 dark:border-gray-600 rounded px-1.5 py-0.5 focus:outline-none focus:border-teal-400 dark:focus:border-teal-600"
                />
              ) : (
                <div className="flex items-center gap-1.5 group mb-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight">{note.title}</h2>
                  <button
                    onClick={() => { setRenameValue(note.title); setRenaming(true) }}
                    title="Rename"
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-opacity cursor-pointer"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative" ref={typePickerRef}>
                  <button
                    onClick={() => setTypePickerOpen(v => !v)}
                    disabled={settingType}
                    className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: `${typeColors[note.type] ?? '#94a3b8'}22`, color: typeColors[note.type] ?? '#94a3b8' }} // 22 = ~8% alpha (8-digit hex)
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: typeColors[note.type] ?? '#94a3b8' }} />
                    {note.type}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {typePickerOpen && noteTypes.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg shadow-lg p-2 min-w-[180px]">
                      <div className="grid grid-cols-2 gap-1">
                        {noteTypes.map(t => (
                          <button
                            key={t.name}
                            onClick={() => handleSetType(t.name)}
                            disabled={settingType}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors text-left w-full ${
                              t.name === note.type
                                ? 'bg-slate-100 dark:bg-gray-800 font-medium text-gray-900 dark:text-white'
                                : 'hover:bg-slate-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
              {note?.type === 'person' && (session as any)?.googleEnabled && (
                (session as any)?.googleConnected ? (
                  <button
                    onClick={() => setGmailOpen(true)}
                    title="Search emails in Gmail"
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </button>
                ) : (session as any)?.googleError === 'RefreshTokenError' ? (
                  <button
                    onClick={() => onOpenSettings?.()}
                    title="Gmail connection expired — reconnect in settings"
                    className="p-1.5 rounded-md text-amber-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </button>
                ) : null
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

              <div className="border-t border-slate-100 dark:border-gray-800/60 px-5 py-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">Links to</h3>
                    <button
                      onClick={() => {
                        setLinkPickerOpen(v => !v)
                        if (pickerTypes.length > 0 && !pickerType) setPickerType(pickerTypes[0])
                      }}
                      className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
                    >
                      + Toevoegen
                    </button>
                  </div>
                  {(note.relations.length > 0 || untypedManaged.length > 0 || organicLinks.length > 0) && (
                    <ul className="space-y-0.5">
                      {note.relations.map(rel => {
                        const targetId = rel.target.toLowerCase()
                        const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
                        return (
                          <li key={`rel-${rel.target}`} className="flex items-center gap-2 py-0.5 group">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                            <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
                              {nodeById[targetId]?.title ?? rel.target}
                            </button>
                            <span className="text-xs text-orange-500/70 shrink-0">{rel.type}</span>
                            <button
                              onClick={() => handleRemoveRelation(rel.target)}
                              disabled={removingLink !== null}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 disabled:opacity-30"
                              title="Remove link"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </li>
                        )
                      })}
                      {untypedManaged.map(stem => {
                        const targetId = stem.toLowerCase()
                        const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
                        return (
                          <li key={`managed-${stem}`} className="flex items-center gap-2 py-0.5 group">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                            <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
                              {nodeById[targetId]?.title ?? stem}
                            </button>
                            <button
                              onClick={() => handleRemoveRelation(stem)}
                              disabled={removingLink !== null}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 disabled:opacity-30"
                              title="Remove link"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </li>
                        )
                      })}
                      {organicLinks.map(stem => {
                        const targetId = stem.toLowerCase()
                        const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
                        return (
                          <li key={`organic-${stem}`} className="flex items-center gap-2 py-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                            <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
                              {nodeById[targetId]?.title ?? stem}
                            </button>
                            <span className="text-xs text-slate-300 dark:text-gray-600 shrink-0" title="In-text link">↩</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {linkPickerOpen && (
                    <div className="mt-3 border border-slate-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <div className="flex overflow-x-auto border-b border-slate-100 dark:border-gray-800">
                        {pickerTypes.map(t => (
                          <button
                            key={t}
                            onClick={() => { setPickerType(t); setPickerTarget('') }}
                            className={`px-3 py-1.5 text-xs whitespace-nowrap cursor-pointer transition-colors ${
                              pickerType === t
                                ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-500'
                                : 'text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="max-h-36 overflow-y-auto">
                        {pickerNotes.length === 0 ? (
                          <p className="text-xs text-slate-400 dark:text-gray-600 px-3 py-2 italic">No notes of this type</p>
                        ) : (
                          pickerNotes.map(n => (
                            <button
                              key={n.id}
                              onClick={() => setPickerTarget(pickerTarget === n.id ? '' : n.id)}
                              className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                                pickerTarget === n.id
                                  ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 font-medium'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                              }`}
                            >
                              {n.title}
                            </button>
                          ))
                        )}
                      </div>
                      <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800 flex items-center gap-2">
                        <select
                          value={pickerRelationType}
                          onChange={e => setPickerRelationType(e.target.value)}
                          className="flex-1 text-xs bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded px-1.5 py-1 text-slate-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
                        >
                          <option value="">— geen relatietype —</option>
                          <option value="works_with">works_with</option>
                          <option value="part_of">part_of</option>
                          <option value="inspired_by">inspired_by</option>
                          <option value="references">references</option>
                        </select>
                        <button
                          onClick={handleAddRelation}
                          disabled={!pickerTarget || addingLink}
                          className="px-2.5 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {addingLink ? '…' : 'Toevoegen'}
                        </button>
                        <button
                          onClick={() => setLinkPickerOpen(false)}
                          className="text-xs text-slate-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>

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
            </div>
          )}
        </>
      )}
      {gmailOpen && note && (
        <GmailModal
          note={{ path: note.path, title: note.title, email: note.email }}
          onClose={() => setGmailOpen(false)}
          onAppended={() => { setGmailOpen(false); onNoteUpdated() }}
        />
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
