'use client'
import { useState, useEffect } from 'react'

type Provider = 'github' | 'gitlab' | 'local'

interface SetupData {
  provider: Provider
  // GitHub
  githubOwner: string
  githubRepo: string
  githubBranch: string
  githubToken: string
  // GitLab
  gitlabUrl: string
  gitlabNamespace: string
  gitlabProject: string
  gitlabBranch: string
  gitlabToken: string
  // Profile
  userName: string
  userRole: string
  // Local vault
  vaultPath: string
  // Template
  useTemplate: boolean
}

interface Props {
  onComplete: () => void
}

const STEPS = ['Welcome', 'Provider', 'Credentials', 'Local vault', 'Profile', 'Review'] as const
type Step = typeof STEPS[number]

function StepIndicator({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold transition-all duration-300 ${
            i < current
              ? 'bg-teal-500 text-white'
              : i === current
                ? 'bg-teal-600 text-white ring-4 ring-teal-500/20'
                : 'bg-slate-200 dark:bg-gray-700 text-slate-400 dark:text-gray-500'
          }`}>
            {i < current ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-0.5 rounded-full transition-colors duration-300 ${
              i < current ? 'bg-teal-500' : 'bg-slate-200 dark:bg-gray-700'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<SetupData>({
    provider: 'github',
    githubOwner: '',
    githubRepo: 'superbrain-vault',
    githubBranch: 'main',
    githubToken: '',
    gitlabUrl: 'https://gitlab.com',
    gitlabNamespace: '',
    gitlabProject: 'superbrain-vault',
    gitlabBranch: 'main',
    gitlabToken: '',
    userName: '',
    userRole: '',
    vaultPath: '',
    useTemplate: true,
  })
  const [isServerless, setIsServerless] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [vaultConfigJson, setVaultConfigJson] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/vault/config')
      .then(res => res.json())
      .then(data => { if (typeof data.isServerless === 'boolean') setIsServerless(data.isServerless) })
      .catch(() => {})
  }, [])

  function update(fields: Partial<SetupData>) {
    setData(prev => ({ ...prev, ...fields }))
    setError(null)
    setValidationResult(null)
  }

  async function validate() {
    setValidating(true)
    setValidationResult(null)
    try {
      const body = data.provider === 'gitlab'
        ? { action: 'validate', provider: 'gitlab', token: data.gitlabToken, namespace: data.gitlabNamespace, project: data.gitlabProject, branch: data.gitlabBranch, url: data.gitlabUrl }
        : { action: 'validate', provider: 'github', token: data.githubToken, owner: data.githubOwner, repo: data.githubRepo, branch: data.githubBranch }
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      setValidationResult({ ok: res.ok, message: result.message ?? result.error ?? (res.ok ? 'Connected!' : 'Failed') })
    } catch {
      setValidationResult({ ok: false, message: 'Network error' })
    } finally {
      setValidating(false)
    }
  }

  async function handleFinish() {
    setSaving(true)
    setError(null)
    try {
      let body: Record<string, unknown>
      if (data.provider === 'gitlab') {
        body = { action: 'setup', provider: 'gitlab', token: data.gitlabToken, namespace: data.gitlabNamespace, project: data.gitlabProject, branch: data.gitlabBranch, url: data.gitlabUrl, userName: data.userName, userRole: data.userRole, vaultPath: data.vaultPath || undefined, useTemplate: data.useTemplate }
      } else if (data.provider === 'local') {
        body = { action: 'setup', provider: 'local', vaultPath: data.vaultPath, userName: data.userName, userRole: data.userRole, useTemplate: data.useTemplate }
      } else {
        body = { action: 'setup', provider: 'github', token: data.githubToken, owner: data.githubOwner, repo: data.githubRepo, branch: data.githubBranch, userName: data.userName, userRole: data.userRole, vaultPath: data.vaultPath || undefined, useTemplate: data.useTemplate }
      }
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({}))
        throw new Error(result.error ?? `Setup failed (HTTP ${res.status})`)
      }
      const result = await res.json()
      if (result.serverless) {
        // Serverless: assemble VAULT_CONFIG client-side so the token never round-trips via the server response
        let remote: Record<string, unknown>
        if (data.provider === 'gitlab') {
          remote = { provider: 'gitlab', token: data.gitlabToken, namespace: data.gitlabNamespace, project: data.gitlabProject, branch: data.gitlabBranch || 'main', ...(data.gitlabUrl ? { url: data.gitlabUrl } : {}) }
        } else {
          remote = { provider: 'github', token: data.githubToken, owner: data.githubOwner, repo: data.githubRepo, branch: data.githubBranch || 'main' }
        }
        const configForCopy: Record<string, unknown> = { remote, ...(data.vaultPath ? { local: { path: data.vaultPath } } : {}) }
        setVaultConfigJson(JSON.stringify(configForCopy))
        setSaving(false)
        return
      }
      onComplete()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setSaving(false)
    }
  }

  function canProceed(): boolean {
    if (step === 1) return true // provider choice always valid
    if (step === 2) {
      if (data.provider === 'github') return !!(data.githubOwner && data.githubRepo && data.githubToken)
      if (data.provider === 'gitlab') return !!(data.gitlabNamespace && data.gitlabProject && data.gitlabToken)
      return !!data.vaultPath // local requires path
    }
    return true
  }

  const inputClass = 'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 dark:focus:border-teal-500 font-mono placeholder:text-slate-400 dark:placeholder:text-gray-600 transition-all'
  const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5'
  const hintClass = 'text-[11px] text-slate-400 dark:text-gray-500 mt-1'

  // Vercel copy block shown after setup
  if (vaultConfigJson) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950 p-4">
        <div className="w-full max-w-lg space-y-5">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center mb-3 shadow-lg shadow-teal-500/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Almost there!</h1>
            <p className="text-sm text-slate-500 dark:text-gray-500 mt-1">Add this environment variable to your Vercel project settings.</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-5 space-y-4 shadow-xl">
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Variable name</p>
              <code className="block w-full px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono">VAULT_CONFIG</code>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Value</p>
              <div className="relative">
                <textarea
                  readOnly
                  value={vaultConfigJson}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-none"
                  rows={4}
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(vaultConfigJson); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="absolute top-2 right-2 px-2 py-1 text-[11px] bg-teal-600 text-white rounded font-medium hover:bg-teal-500 cursor-pointer transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Go to your Vercel project → <strong>Settings → Environment Variables</strong> → add <code className="text-[10px] bg-amber-100 dark:bg-amber-500/20 px-1 rounded">VAULT_CONFIG</code> with this value, then redeploy.
              </p>
            </div>
            <button
              onClick={onComplete}
              className="w-full px-5 py-2.5 text-xs bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-500 transition-colors cursor-pointer"
            >
              Continue to Superbrain →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950 p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center mb-3 shadow-lg shadow-teal-500/20">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Superbrain</h1>
          <p className="text-sm text-slate-500 dark:text-gray-500 mt-0.5">Set up your personal knowledge graph</p>
        </div>

        <div className="flex justify-center">
          <StepIndicator current={step} steps={STEPS} />
        </div>

        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 shadow-xl">

          {/* Step 0 — Welcome */}
          {step === 0 && (
            <div className="space-y-5" key="welcome">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Welcome</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                  Superbrain turns your markdown vault into an interactive knowledge graph. Notes are stored in a Git repository and optionally synced with a local folder.
                </p>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">How would you like to start?</p>
                {([
                  { value: false, label: 'Fresh start', desc: 'Empty vault with just a welcome note' },
                  { value: true, label: 'Start with template', desc: 'Pre-configured folders, system files for Claude, and note templates' },
                ] as const).map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => update({ useTemplate: opt.value })}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer ${
                      data.useTemplate === opt.value
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-500/10'
                        : 'border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1 — Provider */}
          {step === 1 && (
            <div className="space-y-4" key="provider">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Vault provider</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">Where are your vault notes stored?</p>
              </div>
              <div className="space-y-3">
                {([
                  { value: 'github' as Provider, label: 'GitHub', desc: 'Public or private GitHub repository', disabled: false },
                  { value: 'gitlab' as Provider, label: 'GitLab', desc: 'GitLab.com or self-hosted GitLab instance', disabled: false },
                  { value: 'local' as Provider, label: 'Local only', desc: 'Local folder only (localhost, no remote sync)', disabled: isServerless },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => !opt.disabled && update({ provider: opt.value })}
                    disabled={opt.disabled}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      opt.disabled
                        ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-gray-700'
                        : data.provider === opt.value
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-500/10 cursor-pointer'
                          : 'border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600 cursor-pointer'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Credentials */}
          {step === 2 && (
            <div className="space-y-4" key="credentials">
              {data.provider === 'github' && (
                <>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">GitHub repository</h2>
                    <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                      Create a <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">new private repo</a> if you don&apos;t have one yet.
                    </p>
                  </div>
                  <div>
                    <label className={labelClass}>GitHub username</label>
                    <input type="text" value={data.githubOwner} onChange={e => update({ githubOwner: e.target.value })} placeholder="your-username" className={inputClass} autoFocus />
                  </div>
                  <div>
                    <label className={labelClass}>Repository name</label>
                    <input type="text" value={data.githubRepo} onChange={e => update({ githubRepo: e.target.value })} placeholder="superbrain-vault" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Branch</label>
                    <input type="text" value={data.githubBranch} onChange={e => update({ githubBranch: e.target.value })} placeholder="main" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Personal Access Token (PAT)</label>
                    <input type="password" value={data.githubToken} onChange={e => update({ githubToken: e.target.value })} placeholder="github_pat_xxxx" className={inputClass} />
                    <p className={hintClass}>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">fine-grained token</a> with <strong className="text-gray-600 dark:text-gray-300">Contents: Read and Write</strong> access.</p>
                  </div>
                </>
              )}
              {data.provider === 'gitlab' && (
                <>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">GitLab repository</h2>
                    <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">Connect to a GitLab.com or self-hosted GitLab project.</p>
                  </div>
                  <div>
                    <label className={labelClass}>GitLab URL</label>
                    <input type="text" value={data.gitlabUrl} onChange={e => update({ gitlabUrl: e.target.value })} placeholder="https://gitlab.com" className={inputClass} autoFocus />
                    <p className={hintClass}>Leave as https://gitlab.com for GitLab.com, or enter your self-hosted URL.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Namespace (username or group)</label>
                    <input type="text" value={data.gitlabNamespace} onChange={e => update({ gitlabNamespace: e.target.value })} placeholder="your-username" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Project name</label>
                    <input type="text" value={data.gitlabProject} onChange={e => update({ gitlabProject: e.target.value })} placeholder="superbrain-vault" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Branch</label>
                    <input type="text" value={data.gitlabBranch} onChange={e => update({ gitlabBranch: e.target.value })} placeholder="main" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Access Token</label>
                    <input type="password" value={data.gitlabToken} onChange={e => update({ gitlabToken: e.target.value })} placeholder="glpat-xxxx" className={inputClass} />
                    <p className={hintClass}>Create a personal access token with <strong className="text-gray-600 dark:text-gray-300">read_repository + write_repository</strong> scope.</p>
                  </div>
                </>
              )}
              {data.provider === 'local' && (
                <>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Local vault path</h2>
                    <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">Absolute path to your local vault folder.</p>
                  </div>
                  <div>
                    <label className={labelClass}>Vault path</label>
                    <input type="text" value={data.vaultPath} onChange={e => update({ vaultPath: e.target.value })} placeholder="/Users/you/superbrain-vault" className={inputClass} autoFocus />
                  </div>
                </>
              )}
              {data.provider !== 'local' && (
                <>
                  <button
                    onClick={validate}
                    disabled={!canProceed() || validating}
                    className="w-full px-4 py-2.5 text-xs bg-slate-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {validating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
                        Testing connection...
                      </span>
                    ) : 'Test connection'}
                  </button>
                  {validationResult && (
                    <div className={`rounded-lg p-3 text-xs ${
                      validationResult.ok
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                        : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
                    }`}>
                      {validationResult.message}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3 — Local vault (only for remote providers) */}
          {step === 3 && (
            <div className="space-y-4" key="local">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Local vault</h2>
                {isServerless ? (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3">
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                      <strong>Serverless environment.</strong> Local vault sync requires running the app on localhost.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                    Optionally connect a local folder. Changes sync automatically between local and remote.
                  </p>
                )}
              </div>
              {!isServerless && data.provider !== 'local' && (
                <div>
                  <label className={labelClass}>Local vault path <span className="text-slate-400 dark:text-gray-600 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={data.vaultPath}
                    onChange={e => update({ vaultPath: e.target.value })}
                    placeholder="/Users/you/superbrain-vault"
                    className={inputClass}
                    autoFocus
                  />
                  <p className={hintClass}>Leave empty to use remote only.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Profile */}
          {step === 4 && (
            <div className="space-y-4" key="profile">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Your profile</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                  {data.useTemplate ? 'Used to personalize your vault template files.' : 'Optional — fill in later.'}
                </p>
              </div>
              <div>
                <label className={labelClass}>Your name</label>
                <input type="text" value={data.userName} onChange={e => update({ userName: e.target.value })} placeholder="Alice Johnson" className={inputClass} autoFocus />
              </div>
              <div>
                <label className={labelClass}>Role / title <span className="text-slate-400 dark:text-gray-600 font-normal">(optional)</span></label>
                <input type="text" value={data.userRole} onChange={e => update({ userRole: e.target.value })} placeholder="Software Engineer" className={`${inputClass} font-sans`} />
              </div>
            </div>
          )}

          {/* Step 5 — Review */}
          {step === 5 && (
            <div className="space-y-4" key="review">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Review</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400">Confirm your settings.</p>
              </div>
              <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-gray-500">Provider</span>
                  <span className="text-gray-900 dark:text-gray-100 capitalize">{data.provider}</span>
                </div>
                {data.provider === 'github' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Repository</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">{data.githubOwner}/{data.githubRepo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Branch</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">{data.githubBranch}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Token</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">••••{data.githubToken.slice(-4)}</span>
                    </div>
                  </>
                )}
                {data.provider === 'gitlab' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Instance</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{data.gitlabUrl}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Project</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">{data.gitlabNamespace}/{data.gitlabProject}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 dark:text-gray-500">Token</span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">••••{data.gitlabToken.slice(-4)}</span>
                    </div>
                  </>
                )}
                {data.provider === 'local' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Path</span>
                    <span className="font-mono text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{data.vaultPath}</span>
                  </div>
                )}
                {data.vaultPath && data.provider !== 'local' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Local path</span>
                    <span className="font-mono text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{data.vaultPath}</span>
                  </div>
                )}
                {data.userName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Name</span>
                    <span className="text-gray-900 dark:text-gray-100">{data.userName}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-gray-700">
                  <span className="text-slate-500 dark:text-gray-500">Template</span>
                  <span className="text-gray-900 dark:text-gray-100">{data.useTemplate ? 'Pre-configured' : 'Fresh start'}</span>
                </div>
              </div>
              {isServerless && (
                <div className="rounded-lg bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 p-3">
                  <p className="text-xs text-teal-700 dark:text-teal-400 leading-relaxed">
                    After setup, you&apos;ll get a <code className="text-[10px] bg-teal-100 dark:bg-teal-500/20 px-1 rounded">VAULT_CONFIG</code> value to copy into your Vercel project settings.
                  </p>
                </div>
              )}
              {error && (
                <div className="rounded-lg p-3 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 text-xs">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100 dark:border-gray-800">
            {step > 0 ? (
              <button onClick={() => setStep(s => {
                const prev = s - 1
                // Skip "Local vault" step for local provider when going back
                if (prev === 3 && data.provider === 'local') return prev - 1
                return prev
              })} className="px-4 py-2 text-xs text-slate-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium cursor-pointer transition-colors">
                ← Back
              </button>
            ) : <div />}

            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(s => {
                  const next = s + 1
                  // Skip "Local vault" step for local provider (already collected on step 2)
                  if (next === 3 && data.provider === 'local') return next + 1
                  return next
                })}
                disabled={!canProceed()}
                className="px-5 py-2.5 text-xs bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                className="px-5 py-2.5 text-xs bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-500 transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                    Setting up...
                  </span>
                ) : 'Complete setup'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400 dark:text-gray-600 mt-4">
          All settings can be changed later in the Settings panel.
        </p>
      </div>
    </div>
  )
}
