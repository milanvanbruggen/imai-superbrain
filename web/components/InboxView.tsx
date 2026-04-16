'use client'
import { useState } from 'react'
import { VaultNote } from '@/lib/types'
import { useToast } from '@/components/Toaster'

// ── Diff ──────────────────────────────────────────────────────────────────────

type DiffLine = { type: 'same' | 'add' | 'remove' | 'ellipsis'; line: string }

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])

  // Backtrack
  const raw: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.unshift({ type: 'same', line: oldLines[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ type: 'add', line: newLines[j - 1] }); j--
    } else {
      raw.unshift({ type: 'remove', line: oldLines[i - 1] }); i--
    }
  }

  // Collapse unchanged sections — keep 3 lines of context around each change
  const CONTEXT = 3
  const changed = new Set(raw.flatMap((d, idx) => d.type !== 'same' ? [idx] : []))
  const visible = new Set<number>()
  for (const idx of changed)
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(raw.length - 1, idx + CONTEXT); k++)
      visible.add(k)

  const result: DiffLine[] = []
  let prevVisible = true
  for (let idx = 0; idx < raw.length; idx++) {
    if (visible.has(idx)) {
      result.push(raw[idx])
      prevVisible = true
    } else if (prevVisible) {
      result.push({ type: 'ellipsis', line: '' })
      prevVisible = false
    }
  }
  return result
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const diff = computeDiff(oldContent.trim(), newContent.trim())
  const hasChanges = diff.some(d => d.type !== 'same' && d.type !== 'ellipsis')

  if (!hasChanges) {
    return <p className="text-xs text-gray-400 dark:text-gray-600 italic px-1">No content changes</p>
  }

  return (
    <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-gray-700 text-[11px] font-mono">
      {diff.map((d, i) => {
        if (d.type === 'ellipsis') {
          return (
            <div key={i} className="px-3 py-0.5 text-gray-300 dark:text-gray-600 bg-slate-50 dark:bg-gray-900 select-none">
              ···
            </div>
          )
        }
        return (
          <div
            key={i}
            className={`flex gap-2 px-3 py-px whitespace-pre-wrap leading-5 ${
              d.type === 'add'
                ? 'bg-green-50 dark:bg-green-900/25 text-green-800 dark:text-green-300'
                : d.type === 'remove'
                ? 'bg-red-50 dark:bg-red-900/25 text-red-800 dark:text-red-300'
                : 'bg-white dark:bg-gray-950 text-gray-500 dark:text-gray-500'
            }`}
          >
            <span className="select-none shrink-0 w-3 opacity-60">
              {d.type === 'add' ? '+' : d.type === 'remove' ? '−' : ' '}
            </span>
            <span>{d.line || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  notesByPath: Record<string, VaultNote>
  onSelect: (id: string) => void
  typeColors: Record<string, string>
  onApproved: () => void
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
}

const ACTION_PREFIXES = ['update ', 'add ', 'new ', 'create ', 'update-', 'add-', 'new-', 'create-']

function stripActionPrefix(s: string): string {
  for (const prefix of ACTION_PREFIXES) {
    if (s.startsWith(prefix)) return s.slice(prefix.length).trim()
  }
  return s
}

function findDuplicate(note: VaultNote, allNotes: VaultNote[]): VaultNote | null {
  const titleN = norm(note.title)
  const stemN = norm(note.stem)
  const titleStripped = stripActionPrefix(titleN)
  const stemStripped = stripActionPrefix(stemN)
  return allNotes.find(n => {
    if (n.path === note.path || n.inbox) return false
    const nTitle = norm(n.title)
    const nStem = norm(n.stem)
    return (
      nTitle === titleN || nStem === stemN ||
      nTitle === stemN || nStem === titleN ||
      nTitle === titleStripped || nStem === stemStripped ||
      nTitle === stemStripped || nStem === titleStripped
    )
  }) ?? null
}

function findSuggestedRelations(note: VaultNote, allNotes: VaultNote[]): VaultNote[] {
  const nonInbox = allNotes.filter(n => !n.inbox && n.path !== note.path)
  const formalTargets = new Set(note.relations.map(r => norm(r.target)))
  const stemToNote = new Map(nonInbox.map(n => [norm(n.stem), n]))
  const seen = new Set<string>()
  const results: VaultNote[] = []

  for (const link of note.wikilinks) {
    const linkN = norm(link)
    if (formalTargets.has(linkN)) continue
    const match = stemToNote.get(linkN)
    if (match && !seen.has(match.path)) {
      seen.add(match.path)
      results.push(match)
    }
  }

  const contentLower = note.content.toLowerCase()
  for (const n of nonInbox) {
    if (seen.has(n.path)) continue
    const titleN = norm(n.title)
    const stemN = norm(n.stem)
    if (titleN.length < 3) continue
    if (formalTargets.has(stemN) || formalTargets.has(titleN)) continue
    if (contentLower.includes(titleN)) {
      seen.add(n.path)
      results.push(n)
    }
  }

  return results.slice(0, 5)
}

function formatDayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today'
  const yesterday = new Date(todayStr)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

async function patchNote(path: string, body: object): Promise<boolean> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`/api/vault/note/${encoded}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.ok
}

async function mergeNotes(sourcePath: string, targetPath: string): Promise<boolean> {
  const res = await fetch('/api/vault/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, targetPath }),
  })
  return res.ok
}

interface NoteCardProps {
  note: VaultNote
  duplicate: VaultNote | null
  suggestedRelations: VaultNote[]
  showRelationSuggestions: boolean
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  approved: boolean
  approving: boolean
  onApprove: () => void
  onChanged: () => void
}

function NoteCard({
  note, duplicate, suggestedRelations, showRelationSuggestions,
  typeColors, onSelect, approved, approving, onApprove, onChanged,
}: NoteCardProps) {
  const [addedRelations, setAddedRelations] = useState<Set<string>>(new Set())
  const [addingRelation, setAddingRelation] = useState<string | null>(null)
  const color = typeColors[note.type] ?? '#94a3b8'

  async function handleAddRelation(target: VaultNote) {
    setAddingRelation(target.path)
    const ok = await patchNote(note.path, { operation: 'add-relation', target: target.stem })
    setAddingRelation(null)
    if (ok) {
      setAddedRelations(prev => new Set(prev).add(target.path))
      onChanged()
    }
  }

  if (approved) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 opacity-40">
        <span className="w-2 h-2 rounded-full shrink-0 bg-teal-400" />
        <span className="text-sm text-gray-500 dark:text-gray-500 line-through">{note.title}</span>
        <span className="ml-auto text-[11px] text-teal-500">Done</span>
      </div>
    )
  }

  const pendingRelations = showRelationSuggestions
    ? suggestedRelations.filter(r => !addedRelations.has(r.path))
    : []

  return (
    <div className={`px-4 py-3 rounded-lg transition-colors ${duplicate ? 'bg-amber-50/60 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-500/20' : 'hover:bg-slate-50 dark:hover:bg-gray-800/40'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <button
            onClick={() => onSelect(note.path)}
            className="text-sm font-medium text-gray-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-left cursor-pointer truncate block w-full"
          >
            {note.title}
          </button>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{note.type}</span>
            {note.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[11px] text-gray-400 dark:text-gray-500">#{tag}</span>
            ))}
          </div>
        </div>
        <button
          onClick={onApprove}
          disabled={approving}
          className="shrink-0 ml-2 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 bg-teal-600 hover:bg-teal-500 text-white"
        >
          {approving ? '…' : duplicate ? 'Merge' : 'Approve'}
        </button>
      </div>

      {/* Duplicate warning */}
      {duplicate && (
        <div className="mt-2 ml-5 flex items-start gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
            Already exists as{' '}
            <button onClick={() => onSelect(duplicate.path)} className="font-semibold underline underline-offset-2 cursor-pointer hover:text-amber-700 dark:hover:text-amber-300">
              {duplicate.title}
            </button>
            <span className="text-amber-400 dark:text-amber-600 ml-1">
              · {duplicate.path.split('/').slice(0, -1).join('/') || 'root'}
            </span>
          </span>
        </div>
      )}

      {/* Relation suggestions — only for new notes */}
      {pendingRelations.length > 0 && (
        <div className="mt-2.5 ml-5">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">Suggested relations</p>
          <div className="flex flex-wrap gap-1.5">
            {pendingRelations.map(rel => (
              <button
                key={rel.path}
                onClick={() => handleAddRelation(rel)}
                disabled={addingRelation === rel.path}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="text-gray-300 dark:text-gray-600">+</span>
                <span>{rel.title}</span>
                <span className="px-1 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[10px]">{rel.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface UpdatedNoteCardProps {
  note: VaultNote
  duplicate: VaultNote | null
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  approved: boolean
  approving: boolean
  onApprove: () => void
}

function UpdatedNoteCard({ note, duplicate, typeColors, onSelect, approved, approving, onApprove }: UpdatedNoteCardProps) {
  const [showDiff, setShowDiff] = useState(false)

  const display = duplicate ?? note
  const color = typeColors[display.type] ?? '#94a3b8'

  if (approved) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 opacity-40">
        <span className="w-2 h-2 rounded-full shrink-0 bg-teal-400" />
        <span className="text-sm text-gray-500 dark:text-gray-500 line-through">{display.title}</span>
        <span className="ml-auto text-[11px] text-teal-500">Done</span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
      <div className="flex items-start gap-3">
        <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setShowDiff(v => !v)}
            className="text-sm font-medium text-gray-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-left cursor-pointer truncate block w-full"
          >
            {display.title}
          </button>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{display.type}</span>
            {display.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[11px] text-gray-400 dark:text-gray-500">#{tag}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {duplicate && (
            <button
              onClick={() => onSelect(duplicate.path)}
              className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors cursor-pointer"
              title="Open existing note"
            >
              Open
            </button>
          )}
          <button
            onClick={onApprove}
            disabled={approving}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 bg-teal-600 hover:bg-teal-500 text-white"
          >
            {approving ? '…' : 'Merge'}
          </button>
        </div>
      </div>

      {showDiff && (
        <div className="mt-3 ml-5">
          <DiffView
            oldContent={duplicate?.content ?? ''}
            newContent={note.content}
          />
        </div>
      )}
    </div>
  )
}

interface DaySectionProps {
  day: string
  todayStr: string
  added: VaultNote[]
  updated: VaultNote[]
  allNotes: VaultNote[]
  typeColors: Record<string, string>
  onSelect: (id: string) => void
  onApproved: () => void
}

function DaySection({ day, todayStr, added, updated, allNotes, typeColors, onSelect, onApproved }: DaySectionProps) {
  const toast = useToast()
  const [approvingPaths, setApprovingPaths] = useState<Set<string>>(new Set())
  const [approvedPaths, setApprovedPaths] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)

  const allDayNotes = [...added, ...updated]
  const duplicates = new Map(allDayNotes.map(n => [n.path, findDuplicate(n, allNotes)]))

  // Added notes that match an existing note → treat as updates
  const trueAdded = added.filter(n => !duplicates.get(n.path))
  const addedAsUpdated = added.filter(n => !!duplicates.get(n.path))
  const allUpdated = [...addedAsUpdated, ...updated]

  const pendingNotes = allDayNotes.filter(n => !approvedPaths.has(n.path))
  const suggestions = new Map(trueAdded.map(n => [n.path, findSuggestedRelations(n, allNotes)]))

  async function handleApprove(note: VaultNote) {
    const path = note.path
    setApprovingPaths(prev => new Set(prev).add(path))
    const dup = duplicates.get(path)
    const ok = dup
      ? await mergeNotes(path, dup.path)
      : await patchNote(path, { operation: 'remove-inbox' })
    setApprovingPaths(prev => { const s = new Set(prev); s.delete(path); return s })
    if (ok) {
      setApprovedPaths(prev => new Set(prev).add(path))
      toast(dup ? `Merged "${note.title}"` : `Approved "${note.title}"`)
      onApproved()
    } else {
      toast(`Failed to process "${note.title}"`, 'error')
    }
  }

  async function handleApproveAll() {
    setApprovingAll(true)
    await Promise.all(pendingNotes.map(n => handleApprove(n)))
    setApprovingAll(false)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          {formatDayLabel(day, todayStr)}
        </h2>
        {pendingNotes.length > 1 && (
          <button
            onClick={handleApproveAll}
            disabled={approvingAll}
            className="text-[11px] font-medium text-teal-600 dark:text-teal-400 hover:text-teal-500 transition-colors cursor-pointer disabled:opacity-50"
          >
            {approvingAll ? 'Processing…' : `Approve all (${pendingNotes.length})`}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {trueAdded.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-400 dark:text-gray-600 uppercase tracking-wider mb-1.5 px-1">Added</p>
            <div className="space-y-1">
              {trueAdded.map(note => (
                <NoteCard
                  key={note.path}
                  note={note}
                  duplicate={null}
                  suggestedRelations={suggestions.get(note.path) ?? []}
                  showRelationSuggestions={true}
                  typeColors={typeColors}
                  onSelect={onSelect}
                  approved={approvedPaths.has(note.path)}
                  approving={approvingPaths.has(note.path)}
                  onApprove={() => handleApprove(note)}
                  onChanged={onApproved}
                />
              ))}
            </div>
          </div>
        )}
        {allUpdated.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-gray-400 dark:text-gray-600 uppercase tracking-wider mb-1.5 px-1">Updated</p>
            <div className="space-y-1">
              {allUpdated.map(note => (
                <UpdatedNoteCard
                  key={note.path}
                  note={note}
                  duplicate={duplicates.get(note.path) ?? null}
                  typeColors={typeColors}
                  onSelect={onSelect}
                  approved={approvedPaths.has(note.path)}
                  approving={approvingPaths.has(note.path)}
                  onApprove={() => handleApprove(note)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function InboxView({ notesByPath, onSelect, typeColors, onApproved }: Props) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    return d.toISOString().slice(0, 10)
  })

  const allNotes = Object.values(notesByPath)
  const inboxNotes = allNotes.filter(n => n.inbox)

  const days = last7Days
    .map(day => {
      const added = inboxNotes.filter(n => {
        const activityDate = n.modified ?? n.date
        return activityDate === day && (!n.modified || n.modified === n.date || !n.date)
      })
      const updated = inboxNotes.filter(n => n.modified === day && n.date !== day)
      return { day, added, updated }
    })
    .filter(d => d.added.length > 0 || d.updated.length > 0)

  if (inboxNotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-700">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
        </svg>
        <p className="text-sm text-gray-400 dark:text-gray-600">Inbox is empty</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-2xl mx-auto space-y-8">
        {days.map(({ day, added, updated }) => (
          <DaySection
            key={day}
            day={day}
            todayStr={todayStr}
            added={added}
            updated={updated}
            allNotes={allNotes}
            typeColors={typeColors}
            onSelect={onSelect}
            onApproved={onApproved}
          />
        ))}
        {days.length === 0 && (
          <p className="text-sm text-center text-gray-400 dark:text-gray-600 pt-16">
            {inboxNotes.length} inbox {inboxNotes.length === 1 ? 'note' : 'notes'} outside the last 7 days
          </p>
        )}
      </div>
    </div>
  )
}
