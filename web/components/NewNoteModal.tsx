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
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-5 h-5 rounded bg-teal-100 dark:bg-teal-600/30 flex items-center justify-center">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New Note</h2>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className="text-xs text-slate-500 dark:text-gray-500 mb-1.5 block">Type</label>
            <select
              value={type}
              onChange={e => handleTypeChange(e.target.value as NoteType)}
              className="w-full bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-teal-400 dark:focus:border-teal-600 transition-colors cursor-pointer"
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
              <label className="text-xs text-slate-500 dark:text-gray-500 mb-1.5 block">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Note title..."
                autoFocus
                className="w-full bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-600 focus:outline-none focus:border-teal-400 dark:focus:border-teal-600 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 dark:text-gray-500 mb-1.5 block">Folder</label>
            <input
              type="text"
              value={folder}
              onChange={e => setFolder(e.target.value.replace(/^\/+|\/+$/g, ''))}
              disabled={isDaily}
              className="w-full bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-600 focus:outline-none focus:border-teal-400 dark:focus:border-teal-600 disabled:opacity-40 transition-colors"
            />
          </div>

          <p className="text-xs text-slate-500 dark:text-gray-600 bg-slate-50 dark:bg-gray-800/50 rounded-md px-3 py-2">
            → <code className="text-slate-600 dark:text-gray-500">{path}</code>
          </p>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!isDaily && !title.trim())}
              className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {saving ? 'Creating...' : 'Create Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
