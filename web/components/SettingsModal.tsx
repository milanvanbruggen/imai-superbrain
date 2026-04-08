'use client'
import { useEffect, useState } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'

interface VaultConfig {
  mode: 'local' | 'github' | 'unconfigured'
  vaultPath?: string | null
  owner?: string | null
  repo?: string | null
  branch?: string
  repoUrl?: string | null
  noteCount?: number | null
  configSource?: 'file' | 'env'
  syncEnabled?: boolean
  isServerless?: boolean
}

interface SyncStatus {
  syncEnabled: boolean
  lastSync: string | null
  fileCount: number
}

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const [config, setConfig] = useState<VaultConfig | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [localSaveError, setLocalSaveError] = useState<string | null>(null)
  const [githubSaveError, setGithubSaveError] = useState<string | null>(null)
  const { data: session, update } = useSession()
  const [disconnecting, setDisconnecting] = useState(false)

  // Separate edit states
  const [editingLocal, setEditingLocal] = useState(false)
  const [editingGithub, setEditingGithub] = useState(false)

  // Sync toggle state
  const [togglingSync, setTogglingSync] = useState(false)
  const [showSyncExplainer, setShowSyncExplainer] = useState(false)

  // Editable fields
  const [editRepoUrl, setEditRepoUrl] = useState('')
  const [editBranch, setEditBranch] = useState('main')
  const [editVaultPath, setEditVaultPath] = useState('')

  useEffect(() => {
    fetch('/api/vault/config')
      .then(r => r.json().catch(() => null))
      .then((c: VaultConfig | null) => {
        if (!c) return
        setConfig(c)
        setEditVaultPath(c.vaultPath ?? '')
        setEditRepoUrl(c.owner && c.repo ? `https://github.com/${c.owner}/${c.repo}.git` : '')
        setEditBranch(c.branch ?? 'main')
      })
    fetch('/api/vault/sync').then(r => r.json().catch(() => null)).then(d => { if (d) setSyncStatus(d) }).catch(() => {})
  }, [])

  function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }

  function formatRelativeTime(isoString: string | null): string {
    if (!isoString) return 'Never'
    const diff = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  async function handleSaveLocal() {
    setSaving(true)
    setLocalSaveError(null)
    try {
      const res = await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'local', vaultPath: editVaultPath }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to save')
      }
      const updated = await fetch('/api/vault/config').then(r => r.json().catch(() => null))
      if (updated) {
        setConfig(updated)
        setEditVaultPath(updated.vaultPath ?? '')
      }
      setEditingLocal(false)
    } catch (e: unknown) {
      setLocalSaveError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveGithub() {
    setSaving(true)
    setGithubSaveError(null)
    try {
      const parsed = parseGitHubUrl(editRepoUrl)
      if (!parsed) throw new Error('Invalid GitHub URL. Use: https://github.com/owner/repo.git')
      const res = await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'github', owner: parsed.owner, repo: parsed.repo, branch: editBranch }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to save')
      }
      const updated = await fetch('/api/vault/config').then(r => r.json().catch(() => null))
      if (updated) {
        setConfig(updated)
        setEditRepoUrl(updated.owner && updated.repo ? `https://github.com/${updated.owner}/${updated.repo}.git` : '')
        setEditBranch(updated.branch ?? 'main')
      }
      setEditingGithub(false)
    } catch (e: unknown) {
      setGithubSaveError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetPrimary(mode: 'local' | 'github') {
    const res = await fetch('/api/vault/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, vaultPath: config?.vaultPath, owner: config?.owner, repo: config?.repo, branch: config?.branch }),
    })
    if (res.ok) {
      const updated = await fetch('/api/vault/config').then(r => r.json().catch(() => null))
      if (updated) setConfig(updated)
    }
  }

  async function handleSyncToggle(enabled: boolean) {
    setTogglingSync(true)
    try {
      await fetch('/api/vault/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncEnabled: enabled }),
      })
      const [updatedConfig, updatedSync] = await Promise.all([
        fetch('/api/vault/config').then(r => r.json().catch(() => null)),
        fetch('/api/vault/sync').then(r => r.json().catch(() => null)),
      ])
      if (updatedConfig) setConfig(updatedConfig)
      if (updatedSync) setSyncStatus(updatedSync)
    } finally {
      setTogglingSync(false)
    }
  }

  const inputClass = 'w-full px-3 py-1.5 text-sm rounded-md border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono'

  // Auto-sync section variables
  const bothConfigured = !!(config?.vaultPath && config?.owner && config?.repo)
  const syncOn = syncStatus?.syncEnabled ?? false

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
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Settings</h2>
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
            {/* Vault section */}
            <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-4">
              <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Vault</span>

              {config.isServerless && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    <strong>Serverless mode</strong> — Configuration is read from environment variables. To change vault settings, update <code className="text-[10px] bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded">GITHUB_PAT</code>, <code className="text-[10px] bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded">GITHUB_VAULT_OWNER</code>, <code className="text-[10px] bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded">GITHUB_VAULT_REPO</code> in your Vercel project settings.
                  </p>
                </div>
              )}

              {/* Local vault */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Local path</span>
                  {!editingLocal && !config.isServerless && (
                    <button onClick={() => setEditingLocal(true)} className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">
                      Edit
                    </button>
                  )}
                </div>
                {editingLocal ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editVaultPath}
                      onChange={e => setEditVaultPath(e.target.value)}
                      placeholder="/Users/you/vault"
                      className={inputClass}
                      autoFocus
                    />
                    {localSaveError && <p className="text-xs text-red-500">{localSaveError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setEditingLocal(false); setLocalSaveError(null) }} className="px-3 py-1 text-xs text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">Cancel</button>
                      <button onClick={handleSaveLocal} disabled={saving} className="px-3 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-60 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-gray-500 font-mono break-all">
                    {config.vaultPath ?? <span className="italic">Not configured</span>}
                  </p>
                )}
              </div>

              {/* GitHub repository */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">GitHub repository</span>
                  {!editingGithub && !config.isServerless && (
                    <button onClick={() => setEditingGithub(true)} className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">
                      Edit
                    </button>
                  )}
                </div>
                {editingGithub ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editRepoUrl}
                      onChange={e => setEditRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo.git"
                      className={inputClass}
                      autoFocus
                    />
                    <input
                      type="text"
                      value={editBranch}
                      onChange={e => setEditBranch(e.target.value)}
                      placeholder="main"
                      className={inputClass}
                    />
                    {githubSaveError && <p className="text-xs text-red-500">{githubSaveError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setEditingGithub(false); setGithubSaveError(null) }} className="px-3 py-1 text-xs text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer">Cancel</button>
                      <button onClick={handleSaveGithub} disabled={saving} className="px-3 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-60 cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {config.owner && config.repo ? (
                      <>
                        <p className="text-xs text-slate-500 dark:text-gray-500 font-mono">{config.owner}/{config.repo}</p>
                        <p className="text-xs text-slate-400 dark:text-gray-600">branch: {config.branch ?? 'main'}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 dark:text-gray-600 italic">Not configured</p>
                    )}
                  </div>
                )}
              </div>

              {/* Primary source — only show if both configured */}
              {config.vaultPath && config.owner && config.repo && (
                <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-gray-700">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Primary source</span>
                  <p className="text-xs text-slate-500 dark:text-gray-500">The vault the graph reads from when sync is off.</p>
                  <div className="flex gap-1 p-0.5 bg-slate-200 dark:bg-gray-700 rounded-md">
                    {(['local', 'github'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => handleSetPrimary(m)}
                        className={`flex-1 text-xs py-1.5 rounded font-medium transition-colors cursor-pointer ${
                          config.mode === m
                            ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-gray-400'
                        }`}
                      >
                        {m === 'local' ? 'Local' : 'GitHub'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-sync section */}
              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Auto-sync</span>
                    {!bothConfigured && (
                      <p className="text-xs text-slate-400 dark:text-gray-600 mt-0.5">Configure both local and GitHub to enable.</p>
                    )}
                  </div>
                  {/* Toggle */}
                  <label className={`relative inline-flex items-center ${(!bothConfigured || togglingSync) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={syncOn}
                      disabled={!bothConfigured || togglingSync}
                      onChange={e => handleSyncToggle(e.target.checked)}
                    />
                    <div className="w-9 h-5 rounded-full bg-gray-300 dark:bg-gray-600 peer-checked:bg-teal-500 peer-disabled:cursor-not-allowed transition-colors duration-200 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:shadow after:transition-transform after:duration-200 peer-checked:after:translate-x-4" />
                  </label>
                </div>

                {syncOn && syncStatus && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500 dark:text-gray-500">
                      Last sync: {formatRelativeTime(syncStatus.lastSync)}
                    </p>
                    <button
                      onClick={() => setShowSyncExplainer(v => !v)}
                      className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <span>{showSyncExplainer ? '▾' : '▸'}</span> How does sync work?
                    </button>
                    {showSyncExplainer && (
                      <p className="text-xs text-slate-500 dark:text-gray-500 leading-relaxed bg-slate-100 dark:bg-gray-800 rounded p-2">
                        Superbrain compares your local vault with GitHub every few seconds and automatically syncs new and changed files. If the same file was changed in both places, the local version wins and the remote version is saved as a .conflict.md file.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Account */}
            <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Account</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-xs text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            </div>

            {/* Integrations — only shown when Google OAuth is configured */}
            {(session as any)?.googleEnabled && <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3">
              <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Integrations</span>

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
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={() => signIn('google', { callbackUrl: window.location.origin })}
                    className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded font-medium hover:bg-teal-500 transition-colors cursor-pointer"
                  >
                    Connect Gmail
                  </button>
                )}
              </div>

              {(session as any)?.googleError === 'RefreshTokenError' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Gmail connection expired.{' '}
                  <button onClick={() => signIn('google', { callbackUrl: window.location.origin })} className="underline cursor-pointer">Reconnect</button>
                </p>
              )}
            </div>}
          </div>
        )}
      </div>
    </div>
  )
}
