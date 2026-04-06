'use client'
import { useEffect, useState, useRef } from 'react'
import type { SystemFile } from '@/app/api/vault/system/route'

interface Props {
  onClose: () => void
}

const SYSTEM_DIRS = ['Claude', 'templates']

async function createEditor(
  el: HTMLElement,
  initialContent: string,
  onChange: (val: string) => void
) {
  const { EditorView, basicSetup } = await import('codemirror')
  const { markdown } = await import('@codemirror/lang-markdown')
  const { oneDark } = await import('@codemirror/theme-one-dark')
  const { EditorState } = await import('@codemirror/state')

  return new EditorView({
    state: EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
      ],
    }),
    parent: el,
  })
}

export function SystemFilesModal({ onClose }: Props) {
  const [files, setFiles] = useState<SystemFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New file state
  const [newFileDir, setNewFileDir] = useState<string | null>(null)
  const [newFileName, setNewFileName] = useState('')

  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<any>(null)

  function refreshFiles() {
    return fetch('/api/vault/system')
      .then(r => r.json())
      .then(d => setFiles(d.files ?? []))
  }

  useEffect(() => { refreshFiles() }, [])

  async function selectFile(path: string) {
    setSelectedPath(path)
    setNewFileDir(null)
    setNewFileName('')
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/vault/note/${path}`)
      if (!res.ok) throw new Error('Failed to load file')
      const { content: c } = await res.json()
      setContent(c)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  // Rebuild editor when selected file changes
  useEffect(() => {
    if (!editorRef.current || loading || selectedPath === null) return
    editorViewRef.current?.destroy()
    editorViewRef.current = null
    createEditor(editorRef.current, content, setContent).then(view => {
      editorViewRef.current = view
    })
    return () => {
      editorViewRef.current?.destroy()
      editorViewRef.current = null
    }
  }, [selectedPath, loading])

  async function handleSave() {
    if (!selectedPath) return
    setSaving(true)
    setError(null)
    try {
      const getRes = await fetch(`/api/vault/note/${selectedPath}`)
      if (!getRes.ok) throw new Error('Failed to fetch SHA')
      const { sha } = await getRes.json()
      const res = await fetch(`/api/vault/note/${selectedPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sha }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateFile() {
    if (!newFileDir || !newFileName.trim()) return
    const name = newFileName.trim().endsWith('.md') ? newFileName.trim() : `${newFileName.trim()}.md`
    const path = newFileDir === '/' ? name : `${newFileDir}/${name}`
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/vault/note/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', sha: null }),
      })
      if (!res.ok) throw new Error('Failed to create file')
      await refreshFiles()
      setNewFileDir(null)
      setNewFileName('')
      selectFile(path)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  // Group files by directory, always show all system dirs
  const groups: Record<string, SystemFile[]> = { '/': [] }
  SYSTEM_DIRS.forEach(d => { groups[d] = [] })
  files.forEach(f => { (groups[f.dir] ??= []).push(f) })

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl shadow-2xl flex overflow-hidden"
        style={{ width: 860, height: 560 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-52 shrink-0 border-r border-slate-200 dark:border-gray-700/80 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-gray-700/80">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">System files</span>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {Object.entries(groups).map(([dir, groupFiles]) => (
              <div key={dir} className="mb-2">
                <div className="flex items-center justify-between px-4 py-1 group">
                  <p className="text-xs font-medium text-slate-400 dark:text-gray-600 uppercase tracking-wider">
                    {dir === '/' ? 'root' : dir}
                  </p>
                  {dir !== '/' && (
                    <button
                      onClick={() => { setNewFileDir(dir); setNewFileName(''); setSelectedPath(null) }}
                      title={`New file in ${dir}/`}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-all cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  )}
                </div>

                {/* New file input */}
                {newFileDir === dir && (
                  <div className="px-3 pb-1.5">
                    <input
                      autoFocus
                      value={newFileName}
                      onChange={e => setNewFileName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateFile()
                        if (e.key === 'Escape') { setNewFileDir(null); setNewFileName('') }
                      }}
                      placeholder="filename.md"
                      className="w-full px-2 py-1 text-xs rounded border border-teal-400 dark:border-teal-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none"
                    />
                  </div>
                )}

                {groupFiles.map(f => (
                  <button
                    key={f.path}
                    onClick={() => selectFile(f.path)}
                    className={`w-full text-left px-4 py-1.5 text-xs transition-colors cursor-pointer ${
                      selectedPath === f.path
                        ? 'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedPath === null && newFileDir === null ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-gray-600">
              Select a file to view or edit
            </div>
          ) : newFileDir !== null && selectedPath === null ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-slate-400 dark:text-gray-600">
              <p>Enter a filename in the sidebar and press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-xs font-mono">Enter</kbd></p>
            </div>
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-slate-400">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              Loading...
            </div>
          ) : (
            <>
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-gray-700/80 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-500 dark:text-gray-500">{selectedPath}</span>
              </div>
              <div ref={editorRef} className="flex-1 overflow-auto text-sm" />
              <div className="px-4 py-3 border-t border-slate-200 dark:border-gray-700/80 flex items-center justify-between">
                {error && <span className="text-red-400 text-xs">{error}</span>}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="ml-auto flex items-center gap-2 px-4 py-1.5 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Saving...
                    </>
                  ) : savedFlash ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Saved
                    </>
                  ) : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
