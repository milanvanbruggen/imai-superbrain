'use client'
import { useState } from 'react'

type NoteType = 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area'

const TYPE_FOLDER: Record<NoteType, string> = {
  person: 'people',
  project: 'projects',
  meeting: 'meetings',
  daily: 'daily',
  idea: 'ideas',
  resource: 'resources',
  area: 'areas',
  note: 'inbox',
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function generateFrontmatter(type: NoteType, title: string): string {
  const date = todayISO()
  switch (type) {
    case 'person':
      return `---\ntitle: "${title}"\ntype: person\ntags: []\nrelations: []\n---\n`
    case 'project':
      return `---\ntitle: "${title}"\ntype: project\ndate: ${date}\ntags: []\nstatus: active\nrelations: []\n---\n\n## Doel\n\n## Voortgang\n\n## Open punten\n`
    case 'area':
      return `---\ntitle: "${title}"\ntype: area\ntags: []\nrelations: []\n---\n\n## Beschrijving\n\n## Standaard en doelen\n`
    case 'idea':
      return `---\ntitle: "${title}"\ntype: idea\ndate: ${date}\ntags: []\nrelations: []\n---\n`
    case 'resource':
      return `---\ntitle: "${title}"\ntype: resource\ntags: []\nsource: ""\nrelations: []\n---\n`
    case 'meeting':
      return `---\ntitle: "${title}"\ntype: meeting\ndate: ${date}\ntags: []\nattendees: []\nrelations: []\n---\n\n## Agenda\n\n## Notities\n\n## Actiepunten\n`
    case 'daily':
      return `---\ntitle: ${date}\ntype: daily\ndate: ${date}\ntags: []\n---\n\n## Focus vandaag\n\n## Log\n\n## Reflectie\n`
    case 'note':
    default:
      return `---\ntitle: "${title}"\ntype: note\ntags: []\n---\n`
  }
}

function buildPath(folder: string, type: NoteType, title: string): string {
  if (type === 'daily') {
    // Daily notes: filename is always the date
    return `${folder}/${todayISO()}.md`
  }
  const slug = title.trim().replace(/[/\\:*?"<>|]/g, '-')
  return `${folder}/${slug}.md`
}

interface Props {
  onClose: () => void
  onCreated: (path: string) => void
}

export function NewNoteModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<NoteType>('note')
  const [folder, setFolder] = useState<string>(TYPE_FOLDER['note'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDaily = type === 'daily'
  const effectiveTitle = isDaily ? todayISO() : title
  const path = buildPath(folder, type, effectiveTitle)

  // When type changes, reset folder to the default for that type
  function handleTypeChange(newType: NoteType) {
    setType(newType)
    setFolder(TYPE_FOLDER[newType])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isDaily && !title.trim()) return
    setSaving(true)
    setError(null)

    const content = generateFrontmatter(type, effectiveTitle)

    // For daily notes, check if file already exists — open it instead of creating
    if (type === 'daily') {
      const existing = await fetch(`/api/vault/note/${path}`)
      if (existing.ok) {
        setSaving(false)
        onCreated(path)
        return
      }
    }

    const res = await fetch(`/api/vault/note/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // sha: null signals a new file to the PUT handler
      body: JSON.stringify({ content, sha: null }),
    })

    if (!res.ok) {
      setError('Failed to create note')
      setSaving(false)
      return
    }

    setSaving(false)
    onCreated(path)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-white mb-4">New Note</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Type</label>
            <select
              value={type}
              onChange={e => handleTypeChange(e.target.value as NoteType)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            >
              <option value="note">Note (inbox)</option>
              <option value="idea">Idea</option>
              <option value="project">Project</option>
              <option value="person">Person</option>
              <option value="meeting">Meeting</option>
              <option value="daily">Daily</option>
              <option value="resource">Resource</option>
              <option value="area">Area</option>
            </select>
          </div>

          {!isDaily && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Note title..."
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Folder</label>
            <input
              type="text"
              value={folder}
              onChange={e => setFolder(e.target.value.replace(/^\/+|\/+$/g, ''))}
              disabled={isDaily}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-40"
            />
          </div>

          <p className="text-xs text-gray-500">Will be saved to: <code className="text-gray-400">{path}</code></p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!isDaily && !title.trim())}
              className="px-4 py-2 text-sm bg-white text-black rounded font-medium hover:bg-gray-200 transition disabled:opacity-40"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
