'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CommitEntry } from '@/lib/vault-history'

interface Props {
  onClose: () => void
  onRestored: () => void
}

type CommitType = 'create' | 'update' | 'delete' | 'rename' | 'sync' | 'restore' | 'other'

interface CommitGroup {
  key: string            // newest commit sha — unique React key
  restoreSha: string     // oldest commit sha — the restore point
  restoreShortSha: string
  label: string
  date: string | null    // date of the oldest (first) commit in the group
  count: number
  type: CommitType
}

function getCommitType(message: string): CommitType {
  if (/^brain: create\b/.test(message)) return 'create'
  if (/^brain: update\b/.test(message)) return 'update'
  if (/^brain: delete\b/.test(message)) return 'delete'
  if (/^brain: rename\b/.test(message)) return 'rename'
  if (/^sync: delete\b/.test(message)) return 'delete'
  if (/^sync: push\b/.test(message)) return 'sync'
  if (/^vault: auto-sync\b/.test(message)) return 'sync'
  if (/^restore:/.test(message)) return 'restore'
  return 'other'
}

const GROUPABLE: CommitType[] = ['create', 'update', 'delete', 'rename', 'sync']

const GROUP_LABEL: Record<CommitType, (n: number) => string> = {
  create:  n => `Created ${n} notes`,
  update:  n => `Updated ${n} notes`,
  delete:  n => `Deleted ${n} notes`,
  rename:  n => `Renamed ${n} notes`,
  sync:    n => `Synced ${n} files`,
  restore: () => '',
  other:   () => '',
}

function groupCommits(commits: CommitEntry[]): CommitGroup[] {
  // GitHub returns commits newest-first. We iterate in that order, so as we
  // extend a group we keep updating restoreSha to the current (older) commit —
  // ending up with the oldest commit in the group as the restore point.
  const groups: CommitGroup[] = []

  for (const commit of commits) {
    const type = getCommitType(commit.message)
    const last = groups[groups.length - 1]

    if (last && GROUPABLE.includes(type) && last.type === type) {
      last.restoreSha = commit.sha
      last.restoreShortSha = commit.shortSha
      last.date = commit.date
      last.count++
      last.label = GROUP_LABEL[type](last.count)
    } else {
      groups.push({
        key: commit.sha,
        restoreSha: commit.sha,
        restoreShortSha: commit.shortSha,
        label: commit.message,
        date: commit.date,
        count: 1,
        type,
      })
    }
  }

  return groups
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Unknown'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function HistoryModal({ onClose, onRestored }: Props) {
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const pageRef = useRef(1)

  const groups = useMemo(() => groupCommits(commits), [commits])

  async function fetchPage(p: number) {
    const res = await fetch(`/api/vault/history?page=${p}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.commits as CommitEntry[]
  }

  useEffect(() => {
    fetchPage(1)
      .then(items => {
        setCommits(items)
        setHasMore(items.length === 50)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!hasMore || loading) return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || loadingMoreRef.current) return
      loadingMoreRef.current = true
      const nextPage = pageRef.current + 1
      setLoadingMore(true)
      fetchPage(nextPage)
        .then(items => {
          setCommits(prev => [...prev, ...items])
          pageRef.current = nextPage
          setHasMore(items.length === 50)
        })
        .catch(() => {})
        .finally(() => {
          loadingMoreRef.current = false
          setLoadingMore(false)
        })
    }, { threshold: 1.0 })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading])

  async function handleRestore(sha: string) {
    setRestoring(true)
    setRestoreError(null)
    try {
      const res = await fetch('/api/vault/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to restore')
      }
      onRestored()
      onClose()
    } catch (e: unknown) {
      setRestoreError(e instanceof Error ? e.message : 'Failed to restore')
      setRestoring(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 w-full max-w-lg shadow-2xl flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 dark:text-gray-400">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Vault History</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            Loading history...
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 py-4">{error}</p>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1" style={{ overflowAnchor: 'none' }}>
            {groups.map(group => (
              <div key={group.key} className="rounded-lg border border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800/50 px-3 py-2.5">
                {confirmingKey === group.key ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-700 dark:text-gray-300">
                      Restore vault to <span className="font-mono text-[11px] bg-slate-200 dark:bg-gray-700 px-1 py-0.5 rounded">{group.restoreShortSha}</span>? This creates a new commit — your current history stays intact.
                    </p>
                    {restoreError && <p className="text-xs text-red-500">{restoreError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setConfirmingKey(null); setRestoreError(null) }}
                        disabled={restoring}
                        className="px-3 py-1 text-xs text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRestore(group.restoreSha)}
                        disabled={restoring}
                        className="px-3 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-60 cursor-pointer"
                      >
                        {restoring ? 'Restoring...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-slate-400 dark:text-gray-500 shrink-0">{group.restoreShortSha}</span>
                    <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{group.label}</span>
                    {group.count > 1 && (
                      <span className="text-[10px] font-medium text-slate-400 dark:text-gray-500 bg-slate-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full shrink-0">
                        ×{group.count}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 dark:text-gray-500 shrink-0">{formatRelativeTime(group.date)}</span>
                    <button
                      onClick={() => setConfirmingKey(group.key)}
                      className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline cursor-pointer shrink-0"
                    >
                      Restore
                    </button>
                  </div>
                )}
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} className="py-1" />}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-400">
                <div className="w-3 h-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
                Loading more...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
