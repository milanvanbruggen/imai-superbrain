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
  const [content, setContent] = useState(note.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editorRef.current) return
    let view: Awaited<ReturnType<typeof createEditor>> | undefined
    createEditor(editorRef.current, note.content, setContent).then(v => {
      view = v
    })
    return () => view?.destroy()
  }, [note.path])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const getRes = await fetch(`/api/vault/note/${note.path}`)
      if (!getRes.ok) throw new Error('Failed to fetch note SHA')
      const { sha } = await getRes.json()

      const res = await fetch(`/api/vault/note/${note.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sha }),
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
