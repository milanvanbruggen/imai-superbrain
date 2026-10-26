'use client'
import { useState } from 'react'
import { VaultNote } from '@/lib/types'
import type { Suggestion } from '@/lib/suggestions'
import { useToast } from '@/components/Toaster'

interface Props {
  suggestions: Suggestion[]
  lastRunAt: string | null
  notesByPath: Record<string, VaultNote>
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  onPreviewMerge: (note: VaultNote, duplicate: VaultNote, suggestionId: string) => void
  onChanged: () => void
}

const RELATION_LABELS: Record<string, string> = {
  works_with: 'works with',
  part_of: 'part of',
  inspired_by: 'inspired by',
}

export async function markSuggestion(id: string, status: 'accepted' | 'dismissed'): Promise<boolean> {
  const res = await fetch('/api/vault/suggestions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status }),
  })
  return res.ok
}

function formatLastRun(iso: string | null): string {
  if (!iso) return 'Not run yet'
  return `Last review ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
}

function NoteLink({ note, color, onSelect }: { note: VaultNote; color: string; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(note.path)}
      className="inline-flex items-center gap-1.5 min-w-0 max-w-full text-sm font-medium text-gray-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer"
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">{note.title}</span>
    </button>
  )
}

function SuggestionCard({
  suggestion, source, target, typeColors, onSelect, onPreviewMerge, onChanged,
}: {
  suggestion: Suggestion
  source: VaultNote
  target: VaultNote
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  onPreviewMerge: Props['onPreviewMerge']
  onChanged: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const isMerge = suggestion.kind === 'merge'

  async function handleConnect() {
    setBusy(true)
    try {
      const encoded = source.path.split('/').map(encodeURIComponent).join('/')
      const res = await fetch(`/api/vault/note/${encoded}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'add-relation', target: target.stem, relationType: suggestion.relationType ?? null }),
      })
      if (!res.ok) {
        toast('Failed to add relation', 'error')
        return
      }
      await markSuggestion(suggestion.id, 'accepted')
      toast(`Connected "${source.title}" to "${target.title}"`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function handleDismiss() {
    setBusy(true)
    try {
      if (await markSuggestion(suggestion.id, 'dismissed')) onChanged()
      else toast('Failed to dismiss suggestion', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-3 rounded-lg bg-violet-50/60 dark:bg-violet-500/5 border border-violet-200/60 dark:border-violet-500/20">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <NoteLink note={source} color={typeColors[source.type] ?? '#94a3b8'} onSelect={onSelect} />
            <span className="text-[11px] text-violet-500 dark:text-violet-400 shrink-0">
              {isMerge ? 'merge into' : RELATION_LABELS[suggestion.relationType ?? ''] ?? 'relates to'}
            </span>
            <NoteLink note={target} color={typeColors[target.type] ?? '#94a3b8'} onSelect={onSelect} />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{suggestion.reason}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={handleDismiss}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 text-gray-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            Dismiss
          </button>
          <button
            onClick={isMerge ? () => onPreviewMerge(source, target, suggestion.id) : handleConnect}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 bg-violet-600 hover:bg-violet-500 text-white"
          >
            {busy ? '…' : isMerge ? 'Review merge' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SuggestionsSection({ suggestions, lastRunAt, notesByPath, typeColors, onSelect, onPreviewMerge, onChanged }: Props) {
  const toast = useToast()
  const [running, setRunning] = useState<'changed' | 'all' | null>(null)

  async function handleRun(scope: 'changed' | 'all') {
    setRunning(scope)
    try {
      const res = await fetch('/api/cron/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(data.message ?? data.error ?? 'AI review failed', 'error')
        return
      }
      toast(data.added > 0 ? `${data.added} new suggestion${data.added === 1 ? '' : 's'}` : 'No new suggestions')
      onChanged()
    } finally {
      setRunning(null)
    }
  }

  const runButton = (scope: 'changed' | 'all', label: string, title: string) => (
    <button
      onClick={() => handleRun(scope)}
      disabled={running !== null}
      title={title}
      className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-500 transition-colors cursor-pointer disabled:opacity-50"
    >
      {running === scope ? 'Reviewing…' : label}
    </button>
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          AI suggestions
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400 dark:text-gray-600">{formatLastRun(lastRunAt)}</span>
          {runButton('changed', 'Check changes', 'Review notes added or changed since the last review')}
          {runButton('all', 'Full scan', 'Review every note in the vault — can take a few minutes')}
        </div>
      </div>
      {suggestions.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-600 italic px-1">No open suggestions</p>
      ) : (
        <div className="space-y-1.5">
          {suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              source={notesByPath[s.source]}
              target={notesByPath[s.target]}
              typeColors={typeColors}
              onSelect={onSelect}
              onPreviewMerge={onPreviewMerge}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  )
}
