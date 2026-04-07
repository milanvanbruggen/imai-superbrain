'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

interface VaultConfig {
  mode: 'local' | 'github' | 'unconfigured'
  vaultPath?: string
  owner?: string
  repo?: string
  branch?: string
  repoUrl?: string
  noteCount?: number | null
}

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const [config, setConfig] = useState<VaultConfig | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const { data: session, update } = useSession()
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch('/api/vault/config')
      .then(r => r.json())
      .then(setConfig)
  }, [])

  async function handleRefresh() {
    setSyncing(true)
    setSyncDone(false)
    await fetch('/api/vault/config', { method: 'POST' })
    // Reload graph after cache invalidation
    await fetch('/api/vault/graph')
    const updated = await fetch('/api/vault/config').then(r => r.json())
    setConfig(updated)
    setSyncing(false)
    setSyncDone(true)
    setTimeout(() => setSyncDone(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 dark:text-gray-400">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Vault Settings</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {!config ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-4">
            {/* Source */}
            <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Source</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  config.mode === 'github'
                    ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : config.mode === 'local'
                      ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400'
                }`}>
                  {config.mode === 'github' ? 'GitHub' : config.mode === 'local' ? 'Local' : 'Not configured'}
                </span>
              </div>

              {config.mode === 'github' && (
                <>
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400 dark:text-gray-500 shrink-0">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <a
                      href={config.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal-600 dark:text-teal-400 hover:underline font-mono"
                    >
                      {config.owner}/{config.repo}
                    </a>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-500">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                      <path d="M18 9a9 9 0 0 1-9 9"/>
                    </svg>
                    branch: <code className="text-slate-600 dark:text-gray-400">{config.branch}</code>
                  </div>
                </>
              )}

              {config.mode === 'local' && (
                <p className="text-xs text-slate-500 dark:text-gray-500 font-mono break-all">{config.vaultPath}</p>
              )}

              {config.noteCount !== null && config.noteCount !== undefined && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-600 pt-1 border-t border-slate-200 dark:border-gray-700">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  {config.noteCount} notes in cache
                </div>
              )}
            </div>

            {/* Change vault instructions */}
            {config.mode === 'github' && (
              <div className="rounded-lg border border-slate-200 dark:border-gray-700 p-4 space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-gray-400">Change vault repository</p>
                <p className="text-xs text-slate-400 dark:text-gray-600 leading-relaxed">
                  Update <code className="text-slate-500 dark:text-gray-500 bg-slate-100 dark:bg-gray-800 px-1 rounded">GITHUB_VAULT_OWNER</code> and <code className="text-slate-500 dark:text-gray-500 bg-slate-100 dark:bg-gray-800 px-1 rounded">GITHUB_VAULT_REPO</code> in your Vercel project settings, then redeploy.
                </p>
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline"
                >
                  Open Vercel dashboard
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
            )}

            {/* Sync button */}
            <div className="flex justify-end pt-1">
              <button
                onClick={handleRefresh}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {syncing ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Refreshing...
                  </>
                ) : syncDone ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Done
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Refresh vault
                  </>
                )}
              </button>
            </div>

            {/* Integraties */}
            <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3">
              <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Integraties</span>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <span className="text-xs text-gray-700 dark:text-gray-300">Gmail</span>
                </div>

                {(session as any)?.googleConnected ? (
                  <button
                    onClick={async () => {
                      setDisconnecting(true)
                      await fetch('/api/gmail/disconnect', { method: 'POST' })
                      await update()
                      setDisconnecting(false)
                    }}
                    disabled={disconnecting}
                    className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {disconnecting ? 'Ontkoppelen...' : 'Ontkoppel'}
                  </button>
                ) : (
                  <a
                    href="/api/auth/signin/google"
                    className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded font-medium hover:bg-teal-500 transition-colors"
                  >
                    Koppel Gmail
                  </a>
                )}
              </div>

              {(session as any)?.googleError === 'RefreshTokenError' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Gmail-verbinding verlopen.{' '}
                  <a href="/api/auth/signin/google" className="underline">Herverbind</a>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
