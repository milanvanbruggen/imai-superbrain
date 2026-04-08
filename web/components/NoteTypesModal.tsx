'use client'
import { useEffect, useState } from 'react'

const DEFAULT_TYPE_NAMES = [
  'person', 'project', 'idea', 'note', 'resource',
  'meeting', 'daily', 'area', 'group', 'system', 'template',
]

const DEFAULT_COLORS: Record<string, string> = {
  person: '#60a5fa',
  project: '#34d399',
  idea: '#f59e0b',
  resource: '#a78bfa',
  note: '#94a3b8',
  meeting: '#06B6D4',
  daily: '#6B7280',
  area: '#EC4899',
  group: '#fb923c',
  system: '#9CA3AF',
  template: '#C084FC',
}

interface NoteType {
  name: string
  color: string
}

interface Props {
  onClose: () => void
  onSaved: () => void
}

export function NoteTypesModal({ onClose, onSaved }: Props) {
  const [types, setTypes] = useState<NoteType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/vault/config')
      .then(r => r.json().catch(() => null))
      .then(c => {
        if (c?.noteTypes && Array.isArray(c.noteTypes) && c.noteTypes.length > 0) {
          setTypes(c.noteTypes)
        } else {
          setTypes(DEFAULT_TYPE_NAMES.map(name => ({ name, color: DEFAULT_COLORS[name] ?? '#94a3b8' })))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function isDefault(name: string) {
    return DEFAULT_TYPE_NAMES.includes(name)
  }

  function updateColor(index: number, color: string) {
    setTypes(prev => prev.map((t, i) => i === index ? { ...t, color } : t))
  }

  function updateName(index: number, name: string) {
    setTypes(prev => prev.map((t, i) => i === index ? { ...t, name } : t))
  }

  function deleteType(index: number) {
    setTypes(prev => prev.filter((_, i) => i !== index))
  }

  function addType() {
    setTypes(prev => [...prev, { name: '', color: '#94a3b8' }])
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteTypes: types }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to save')
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 w-full max-w-sm shadow-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Note Types</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            <div className="overflow-y-auto flex-1 space-y-2 mb-4 pr-1">
              {types.map((type, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <input
                    type="color"
                    value={type.color}
                    onChange={e => updateColor(i, e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-200 dark:border-gray-700 p-0.5 bg-transparent shrink-0"
                    title="Pick color"
                  />
                  {isDefault(type.name) ? (
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{type.name}</span>
                  ) : (
                    <input
                      type="text"
                      value={type.name}
                      onChange={e => updateName(i, e.target.value)}
                      placeholder="type name"
                      className="flex-1 px-2 py-1 text-sm rounded border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  )}
                  {!isDefault(type.name) && (
                    <button
                      onClick={() => deleteType(i)}
                      className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
                      title="Remove type"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={addType}
              className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer self-start mb-4"
            >
              + Add type
            </button>

            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-60 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
