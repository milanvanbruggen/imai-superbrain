'use client'
import { useEffect, useRef, useState } from 'react'
import type { CommitEntry } from '@/lib/vault-history'

interface Props {
  onClose: () => void
  onRestored: () => void
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
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [confirmingSha, setConfirmingSha] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

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
      if (!entries[0].isIntersecting || loadingMore) return
      const nextPage = page + 1
      setLoadingMore(true)
      fetchPage(nextPage)
        .then(items => {
          setCommits(prev => [...prev, ...items])
          setPage(nextPage)
          setHasMore(items.length === 50)
        })
        .catch(() => {})
        .finally(() => setLoadingMore(false))
    }, { threshold: 1.0 })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page])

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
            {commits.map(commit => (
              <div key={commit.sha} className="rounded-lg border border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800/50 px-3 py-2.5">
                {confirmingSha === commit.sha ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-700 dark:text-gray-300">
                      Restore vault to <span className="font-mono text-[11px] bg-slate-200 dark:bg-gray-700 px-1 py-0.5 rounded">{commit.shortSha}</span>? This creates a new commit — your current history stays intact.
                    </p>
                    {restoreError && <p className="text-xs text-red-500">{restoreError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setConfirmingSha(null); setRestoreError(null) }}
                        disabled={restoring}
                        className="px-3 py-1 text-xs text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRestore(commit.sha)}
                        disabled={restoring}
                        className="px-3 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-60 cursor-pointer"
                      >
                        {restoring ? 'Restoring...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-slate-400 dark:text-gray-500 shrink-0">{commit.shortSha}</span>
                    <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{commit.message}</span>
                    <span className="text-[11px] text-slate-400 dark:text-gray-500 shrink-0">{formatRelativeTime(commit.date)}</span>
                    <button
                      onClick={() => setConfirmingSha(commit.sha)}
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
