'use client'
import { useEffect, useState } from 'react'
import { VaultNote } from '@/lib/types'
import { areLinked, type RejectedCandidate, type ReviewProgress, type Suggestion } from '@/lib/suggestions'
import { useToast } from '@/components/Toaster'

interface Props {
  suggestions: Suggestion[]
  /** Unconnected notes the last review found no good match for */
  unlinked: string[]
  /** Pairs the last review looked at in full and decided not to suggest */
  rejected: RejectedCandidate[]
  ownerNote: string | null
  lastRunAt: string | null
  notesByPath: Record<string, VaultNote>
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  /** suggestionId is absent for a merge the review considered but did not suggest */
  onPreviewMerge: (note: VaultNote, duplicate: VaultNote, suggestionId?: string) => void
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

async function addRelation(source: VaultNote, target: VaultNote, relationType: string | null): Promise<boolean> {
  const encoded = source.path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`/api/vault/note/${encoded}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'add-relation', target: target.stem, relationType }),
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
      if (!(await addRelation(source, target, suggestion.relationType ?? null))) {
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
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {suggestion.origin === 'chat' && (
              <span className="mr-1.5 px-1.5 py-px rounded text-[10px] font-medium bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300">from chat</span>
            )}
            {suggestion.reason}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={handleDismiss}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer disabled:opacity-50 text-gray-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            Dismiss
          </button>
          <button
            onClick={isMerge ? () => onPreviewMerge(source, target, suggestion.id) : handleConnect}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer disabled:opacity-50 bg-violet-600 hover:bg-violet-500 text-white"
          >
            {busy ? '…' : isMerge ? 'Review merge' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

type RunEvent =
  | ReviewProgress
  | { phase: 'done'; result: { added: number } }
  | { phase: 'error'; message: string }

/** POSTs a manual review and calls onEvent for every line of the NDJSON progress stream. */
async function streamReview(scope: 'changed' | 'all', onEvent: (event: RunEvent) => void): Promise<void> {
  const res = await fetch('/api/cron/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    onEvent({ phase: 'error', message: data.message ?? data.error ?? `AI review failed (${res.status})` })
    return
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as RunEvent
      if (event.phase === 'done' || event.phase === 'error') finished = true
      onEvent(event)
    }
  }
  // The stream ended without a result — usually the function hit its time limit
  if (!finished) onEvent({ phase: 'error', message: 'The review stopped before finishing (time limit reached?)' })
}

const STEPS = ['reading', 'scanning', 'verifying', 'orphans'] as const

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function RunProgress({ progress, startedAt, totalSteps }: { progress: ReviewProgress | null; startedAt: number; totalSteps: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = formatElapsed(Math.max(0, Math.round((now - startedAt) / 1000)))

  let label = 'Starting review…'
  let counts: string | null = null
  let fraction: number | null = null // null = no countable progress in this step
  if (progress?.phase === 'reading') {
    label = 'Reading notes'
    counts = `${progress.done} / ${progress.total} notes`
    fraction = progress.total ? progress.done / progress.total : 0
  } else if (progress?.phase === 'scanning') {
    label = `Looking for candidates among ${progress.notes} notes`
  } else if (progress?.phase === 'verifying') {
    label = 'Checking candidates in full'
    counts = `${progress.done} / ${progress.total} checked · ${progress.total - progress.done} to go`
    fraction = progress.total ? progress.done / progress.total : 0
  } else if (progress?.phase === 'orphans') {
    label = 'Linking detached notes to your network'
    counts = `${progress.done} / ${progress.total} groups · ${progress.total - progress.done} to go`
    fraction = progress.total ? progress.done / progress.total : 0
  } else if (progress?.phase === 'saving') {
    label = 'Saving suggestions'
  }
  const step = progress && progress.phase !== 'saving' ? STEPS.indexOf(progress.phase) + 1 : null

  return (
    <div className="mb-3 px-4 py-3 rounded-lg border border-violet-200/60 dark:border-violet-500/20 bg-violet-50/40 dark:bg-violet-500/5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {step && <span className="text-gray-400 dark:text-gray-500 font-normal">Step {step} of {totalSteps} · </span>}
          {label}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums shrink-0">{elapsed}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-violet-100 dark:bg-violet-500/10 overflow-hidden">
        {fraction === null ? (
          <div className="h-full w-full rounded-full bg-violet-400/60 animate-pulse" />
        ) : (
          <div className="h-full rounded-full bg-violet-500 transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
        {counts ?? (progress?.phase === 'scanning' ? 'One pass over the whole vault — this step has no item count' : '\u00a0')}
      </p>
    </div>
  )
}

export function SuggestionsSection({ suggestions, unlinked, rejected, ownerNote, lastRunAt, notesByPath, typeColors, onSelect, onPreviewMerge, onChanged }: Props) {
  const toast = useToast()
  const [running, setRunning] = useState<'changed' | 'all' | null>(null)
  const [progress, setProgress] = useState<ReviewProgress | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [showRejected, setShowRejected] = useState(false)
  const [busyRejected, setBusyRejected] = useState<string | null>(null)
  // A rejected relation drops off once the two notes are linked after all
  const visibleRejected = rejected.filter(r =>
    notesByPath[r.a] && notesByPath[r.b] && !(r.kind === 'relation' && areLinked(notesByPath[r.a], notesByPath[r.b])))

  async function connectRejected(r: RejectedCandidate) {
    const a = notesByPath[r.a]
    const b = notesByPath[r.b]
    setBusyRejected(`${r.kind}:${r.a}|${r.b}`)
    try {
      if (!(await addRelation(a, b, null))) {
        toast('Failed to add relation', 'error')
        return
      }
      toast(`Connected "${a.title}" to "${b.title}"`)
      onChanged()
    } finally {
      setBusyRejected(null)
    }
  }

  async function handleRun(scope: 'changed' | 'all') {
    setRunning(scope)
    setProgress(null)
    setStartedAt(Date.now())
    try {
      await streamReview(scope, event => {
        if (event.phase === 'done') {
          const { added } = event.result
          toast(added > 0 ? `${added} new suggestion${added === 1 ? '' : 's'}` : 'No new suggestions')
          onChanged()
        } else if (event.phase === 'error') {
          toast(event.message, 'error')
        } else {
          setProgress(event)
        }
      })
    } catch {
      toast('AI review failed — connection lost', 'error')
    } finally {
      setRunning(null)
      setProgress(null)
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
      {running && <RunProgress progress={progress} startedAt={startedAt} totalSteps={ownerNote ? 4 : 3} />}
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
      {visibleRejected.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowRejected(v => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-600 uppercase tracking-wider px-1 hover:text-gray-600 dark:hover:text-gray-400 transition-colors cursor-pointer"
          >
            <span className={`inline-block transition-transform ${showRejected ? 'rotate-90' : ''}`}>›</span>
            Considered but not suggested ({visibleRejected.length})
          </button>
          {showRejected && (
            <ul className="mt-2 space-y-1.5 px-1">
              {visibleRejected.map(r => (
                <li key={`${r.kind}:${r.a}|${r.b}`} className="text-xs leading-relaxed">
                  <button onClick={() => onSelect(r.a)} className="font-medium text-gray-700 dark:text-gray-300 hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer">
                    {notesByPath[r.a].title}
                  </button>
                  <span className="text-gray-400 dark:text-gray-600"> ↔ </span>
                  <button onClick={() => onSelect(r.b)} className="font-medium text-gray-700 dark:text-gray-300 hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer">
                    {notesByPath[r.b].title}
                  </button>
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600">{r.kind}</span>
                  <button
                    onClick={() => (r.kind === 'merge' ? onPreviewMerge(notesByPath[r.a], notesByPath[r.b]) : connectRejected(r))}
                    disabled={busyRejected === `${r.kind}:${r.a}|${r.b}`}
                    className="ml-2 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-500 cursor-pointer disabled:opacity-50"
                  >
                    {r.kind === 'merge' ? 'Merge anyway' : 'Connect anyway'}
                  </button>
                  <p className="text-gray-500 dark:text-gray-400">{r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ownerNote ? (
        unlinked.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium text-gray-400 dark:text-gray-600 uppercase tracking-wider mb-1 px-1">
              Not connected · no good match ({unlinked.length})
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 mb-2 px-1">
              No path of links connects these notes to yours (a note in a group of linked notes stands for its group), and nothing in your network clearly fits. Connect them yourself, or archive them.
            </p>
            <div className="flex flex-wrap gap-1.5 px-1">
              {unlinked.map(path => {
                const note = notesByPath[path]
                if (!note) return null
                return (
                  <button
                    key={path}
                    onClick={() => onSelect(path)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-slate-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: typeColors[note.type] ?? '#94a3b8' }} />
                    {note.title}
                  </button>
                )
              })}
            </div>
          </div>
        )
      ) : (
        <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-600 px-1">
          Set <span className="font-medium">Your note</span> in Settings to also check notes that aren&apos;t connected to your network.
        </p>
      )}
    </section>
  )
}
