'use client'
import { useState, useEffect, useRef } from 'react'
import { VaultNote } from '@/lib/types'

interface Props {
  note: VaultNote
  onSaved: () => void
}

async function createEditor(
  el: HTMLElement,
  initialContent: string,
  onChange: (val: string) => void
) {
  const { EditorView, basicSetup } = await import('codemirror')
  const { markdown } = await import('@codemirror/lang-markdown')
  const { oneDark } = await import('@codemirror/theme-one-dark')
  const { EditorState } = await import('@codemirror/state')

  const view = new EditorView({
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
  return view
}

export function NoteEditor({ note, onSaved }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState('')
  const [sha, setSha] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewRef = useRef<Awaited<ReturnType<typeof createEditor>> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!editorRef.current) return

      // Fetch full raw content (including frontmatter) from API
      const res = await fetch(`/api/vault/note/${note.path}`)
      if (!res.ok || cancelled) return
      const { content: rawContent, sha: rawSha } = await res.json()

      if (cancelled) return
      setSha(rawSha)
      setContent(rawContent)

      // Destroy previous editor if any
      viewRef.current?.destroy()

      const view = await createEditor(editorRef.current!, rawContent, setContent)
      if (cancelled) {
        view.destroy()
        return
      }
      viewRef.current = view
    }

    init()

    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = undefined
    }
  }, [note.path])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Re-fetch SHA in case it changed since editor opened
      const getRes = await fetch(`/api/vault/note/${note.path}`)
      if (!getRes.ok) throw new Error('Failed to fetch note SHA')
      const { sha: latestSha } = await getRes.json()

      const res = await fetch(`/api/vault/note/${note.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sha: latestSha }),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div ref={editorRef} className="flex-1 overflow-auto text-sm" />
      <div className="p-4 border-t border-gray-800 flex items-center justify-between">
        {error && <span className="text-red-400 text-sm">{error}</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
