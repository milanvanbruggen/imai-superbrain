'use client'
import { useState } from 'react'
import { VaultNote } from '@/lib/types'
import { computeDiff, DiffLine } from '@/lib/diff'
import { mergedBody } from '@/lib/merge-format'
import { useToast } from '@/components/Toaster'

interface Props {
  note: VaultNote          // proposed source: merged away
  duplicate: VaultNote     // proposed target: stays
  typeColors: Record<string, string>
  width: number
  collapsed: boolean
  onToggleCollapse: () => void
  onMerged: () => void
  onClose: () => void
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  const hasChanges = lines.some(d => d.type !== 'same' && d.type !== 'ellipsis')
  if (!hasChanges) {
    return <p className="text-xs text-slate-400 dark:text-gray-600 italic px-5">No content changes</p>
  }
  return (
    <div className="text-[11px] font-mono">
      {lines.map((d, i) => {
        if (d.type === 'ellipsis') {
          return (
            <div key={i} className="px-5 py-0.5 text-gray-300 dark:text-gray-600 bg-slate-50 dark:bg-gray-900/60 select-none">
              ···
            </div>
          )
        }
        return (
          <div
            key={i}
            className={`flex gap-2 px-5 py-px whitespace-pre-wrap leading-5 ${
              d.type === 'add'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : d.type === 'remove'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                : 'text-gray-500 dark:text-gray-500'
            }`}
          >
            <span className="select-none shrink-0 w-3 opacity-50">
              {d.type === 'add' ? '+' : d.type === 'remove' ? '−' : ' '}
            </span>
            <span>{d.line || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

export function DiffPanel({ note: proposedSource, duplicate: proposedTarget, typeColors, width, collapsed, onToggleCollapse, onMerged, onClose }: Props) {
  const toast = useToast()
  const [merging, setMerging] = useState(false)
  const [confirmMerge, setConfirmMerge] = useState(false)
  // You choose which note stays: the proposal is only a starting point
  const [swapped, setSwapped] = useState(false)
  const note = swapped ? proposedTarget : proposedSource
  const duplicate = swapped ? proposedSource : proposedTarget

  const color = typeColors[duplicate.type] ?? '#94a3b8'

  // The same formatting as the merge itself, so the preview matches the result
  const mergedContent = mergedBody(
    { title: note.title, content: note.content, inbox: note.inbox, date: note.modified ?? note.date ?? undefined },
    duplicate.content,
  )
  const diff = computeDiff(duplicate.content.trim(), mergedContent.trim(), Infinity)

  async function handleMerge() {
    setMerging(true)
    try {
      const res = await fetch('/api/vault/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: note.path, targetPath: duplicate.path }),
      })
      if (res.ok) {
        const { relinked = 0, relinkFailed = 0 } = await res.json().catch(() => ({}))
        const links = relinked > 0 ? ` · links in ${relinked} note${relinked === 1 ? '' : 's'} updated` : ''
        toast(`Merged "${note.title}" into "${duplicate.title}"${links}`)
        if (relinkFailed > 0) toast(`${relinkFailed} note${relinkFailed === 1 ? '' : 's'} still link to "${note.title}"`, 'error')
        onMerged()
      } else {
        toast('Failed to merge', 'error')
      }
    } finally {
      setMerging(false)
      setConfirmMerge(false)
    }
  }

  if (collapsed) {
    return (
      <aside className="w-10 border-l border-slate-200 dark:border-gray-800/60 bg-white dark:bg-gray-950 shrink-0 flex flex-col items-center pt-3">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside
      style={{ width }}
      className="relative border-l border-slate-200 dark:border-gray-800/60 overflow-y-auto flex flex-col bg-white dark:bg-gray-950 shrink-0"
    >
      {/* Header */}
      <div className="p-5 border-b border-slate-100 dark:border-gray-800/60 flex items-start justify-between gap-3 sticky top-0 bg-white dark:bg-gray-950 z-10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 leading-tight">{duplicate.title}</h2>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${color}22`, color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              {duplicate.type}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-gray-600">Preview changes</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {confirmMerge ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleMerge}
                disabled={merging}
                className="text-xs px-2.5 py-1 rounded-md bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50 cursor-pointer transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97]"
              >
                {merging ? '…' : 'Confirm merge'}
              </button>
              <button
                onClick={() => setConfirmMerge(false)}
                className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmMerge(true)}
              className="text-xs px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white font-medium transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer"
            >
              Merge
            </button>
          )}
          <button
            onClick={onClose}
            title="Close preview"
            className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Direction: which note is merged away and which one stays */}
      <div className="px-5 py-3 border-b border-slate-100 dark:border-gray-800/60 flex items-center gap-2 text-xs">
        <span className="min-w-0 text-gray-500 dark:text-gray-400">
          Merge <span className="font-medium text-gray-900 dark:text-slate-100">{note.title}</span>
          {' '}into <span className="font-medium text-gray-900 dark:text-slate-100">{duplicate.title}</span>
          <span className="block text-[11px] text-slate-400 dark:text-gray-600">
            {note.title} is removed; links to it will point to {duplicate.title}.
            {!note.inbox && note.title.toLowerCase() !== duplicate.title.toLowerCase() && ` "${note.title}" stays findable as an alias.`}
          </span>
        </span>
        <button
          onClick={() => { setSwapped(v => !v); setConfirmMerge(false) }}
          disabled={merging}
          title="Swap which note stays"
          className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 cursor-pointer transition-[color,background-color,border-color,opacity,scale] ease-out active:scale-[0.97] disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4"/>
          </svg>
          Swap
        </button>
      </div>

      {/* Diff */}
      <div className="flex-1 overflow-y-auto py-4">
        <DiffView lines={diff} />
      </div>
    </aside>
  )
}
