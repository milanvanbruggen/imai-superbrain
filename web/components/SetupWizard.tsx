'use client'
import { useState, useEffect } from 'react'

interface SetupData {
  // GitHub
  githubOwner: string
  githubRepo: string
  githubBranch: string
  githubPat: string
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

const STEPS = ['Welcome', 'GitHub', 'Profile', 'Local vault', 'Review'] as const
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
    githubOwner: '',
    githubRepo: 'superbrain-vault',
    githubBranch: 'main',
    githubPat: '',
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

  useEffect(() => {
    setIsServerless(!!window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  }, [])

  function update(fields: Partial<SetupData>) {
    setData(prev => ({ ...prev, ...fields }))
    setError(null)
    setValidationResult(null)
  }

  async function validateGitHub() {
    setValidating(true)
    setValidationResult(null)
    try {
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate', owner: data.githubOwner, repo: data.githubRepo, branch: data.githubBranch, pat: data.githubPat }),
      })
      const body = await res.json()
      if (res.ok) {
        setValidationResult({ ok: true, message: body.message ?? 'Connection successful!' })
      } else {
        setValidationResult({ ok: false, message: body.error ?? 'Connection failed' })
      }
    } catch {
      setValidationResult({ ok: false, message: 'Network error — could not reach the app' })
    } finally {
      setValidating(false)
    }
  }

  async function handleFinish() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setup',
          owner: data.githubOwner,
          repo: data.githubRepo,
          branch: data.githubBranch,
          pat: data.githubPat,
          userName: data.userName,
          userRole: data.userRole,
          vaultPath: data.vaultPath || undefined,
          useTemplate: data.useTemplate,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Setup failed (HTTP ${res.status})`)
      }
      onComplete()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setSaving(false)
    }
  }

  function canProceed(): boolean {
    if (step === 1) {
      return !!(data.githubOwner && data.githubRepo && data.githubPat)
    }
    return true
  }

  const inputClass = 'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 dark:focus:border-teal-500 font-mono placeholder:text-slate-400 dark:placeholder:text-gray-600 transition-all'
  const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5'
  const hintClass = 'text-[11px] text-slate-400 dark:text-gray-500 mt-1'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-gray-950 p-4">
      <div className="w-full max-w-lg">
        {/* Logo + title */}
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

        {/* Step indicator */}
        <div className="flex justify-center">
          <StepIndicator current={step} steps={STEPS} />
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl p-6 shadow-xl">
          {/* Step 0 — Welcome */}
          {step === 0 && (
            <div className="space-y-5" key="welcome">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Welcome</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                  Superbrain turns your markdown vault into an interactive knowledge graph. Notes are stored in a GitHub repository and optionally synced with a local Obsidian vault.
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">How would you like to start?</p>
                
                <button
                  onClick={() => update({ useTemplate: false })}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    !data.useTemplate
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-500/10'
                      : 'border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${!data.useTemplate ? 'bg-teal-500 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-400'}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Fresh start</p>
                      <p className="text-xs text-slate-500 dark:text-gray-500">Empty vault with just a welcome note</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => update({ useTemplate: true })}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    data.useTemplate
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-500/10'
                      : 'border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${data.useTemplate ? 'bg-teal-500 text-white' : 'bg-slate-100 dark:bg-gray-800 text-slate-400'}`}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Start with template</p>
                      <p className="text-xs text-slate-500 dark:text-gray-500">Pre-configured folders, system files for Claude, and note templates</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 1 — GitHub */}
          {step === 1 && (
            <div className="space-y-4" key="github">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">GitHub Repository</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                  Your vault is stored in a GitHub repository. Create a <a href="https://github.com/new" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">new private repo</a> if you don&apos;t have one yet.
                </p>
              </div>

              <div>
                <label className={labelClass}>GitHub username</label>
                <input
                  type="text"
                  value={data.githubOwner}
                  onChange={e => update({ githubOwner: e.target.value })}
                  placeholder="your-username"
                  className={inputClass}
                  autoFocus
                />
              </div>

              <div>
                <label className={labelClass}>Repository name</label>
                <input
                  type="text"
                  value={data.githubRepo}
                  onChange={e => update({ githubRepo: e.target.value })}
                  placeholder="superbrain-vault"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Branch</label>
                <input
                  type="text"
                  value={data.githubBranch}
                  onChange={e => update({ githubBranch: e.target.value })}
                  placeholder="main"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Personal Access Token (PAT)</label>
                <input
                  type="password"
                  value={data.githubPat}
                  onChange={e => update({ githubPat: e.target.value })}
                  placeholder="github_pat_xxxx"
                  className={inputClass}
                />
                <p className={hintClass}>
                  Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">fine-grained token</a> with <strong className="text-gray-600 dark:text-gray-300">Contents: Read and Write</strong> access on your vault repo.
                </p>
              </div>

              {/* Validate button */}
              <button
                onClick={validateGitHub}
                disabled={!data.githubOwner || !data.githubRepo || !data.githubPat || validating}
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
                  <span className="flex items-center gap-2">
                    {validationResult.ok ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    )}
                    {validationResult.message}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Profile */}
          {step === 2 && (
            <div className="space-y-4" key="profile">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Your Profile</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                  {data.useTemplate
                    ? 'This information is used to personalize your vault template files (e.g. Claude/profile.md).'
                    : 'Optional — you can fill this in later in your vault.'}
                </p>
              </div>

              <div>
                <label className={labelClass}>Your name</label>
                <input
                  type="text"
                  value={data.userName}
                  onChange={e => update({ userName: e.target.value })}
                  placeholder="Alice Johnson"
                  className={inputClass}
                  autoFocus
                />
              </div>

              <div>
                <label className={labelClass}>Role / title <span className="text-slate-400 dark:text-gray-600 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={data.userRole}
                  onChange={e => update({ userRole: e.target.value })}
                  placeholder="e.g. Software Engineer, Product Manager, Founder"
                  className={`${inputClass} font-sans`}
                />
                <p className={hintClass}>
                  Used in the Claude profile template so AI tools know your background.
                </p>
              </div>
            </div>
          )}

          {/* Step 3 — Local vault */}
          {step === 3 && (
            <div className="space-y-4" key="local">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Local Vault</h2>
                {isServerless ? (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 mt-2">
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                      <strong>Serverless environment detected.</strong> Local vault sync is only available when running on localhost. You can configure this later if you run the app locally.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-gray-400 leading-relaxed">
                    Optionally connect a local Obsidian vault folder. Changes will automatically sync between your local files and GitHub.
                  </p>
                )}
              </div>

              {!isServerless && (
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
                  <p className={hintClass}>
                    Absolute path to your Obsidian vault folder. Leave empty to use GitHub only.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <div className="space-y-4" key="review">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Review</h2>
                <p className="text-sm text-slate-500 dark:text-gray-400">
                  Confirm your settings and set up your Superbrain.
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-gray-500">Repository</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{data.githubOwner}/{data.githubRepo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-gray-500">Branch</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">{data.githubBranch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-gray-500">PAT</span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">••••{data.githubPat.slice(-4)}</span>
                </div>
                {data.userName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Name</span>
                    <span className="text-gray-900 dark:text-gray-100">{data.userName}</span>
                  </div>
                )}
                {data.userRole && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Role</span>
                    <span className="text-gray-900 dark:text-gray-100">{data.userRole}</span>
                  </div>
                )}
                {data.vaultPath && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-gray-500">Local path</span>
                    <span className="font-mono text-gray-900 dark:text-gray-100 truncate max-w-[200px]">{data.vaultPath}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-gray-700">
                  <span className="text-slate-500 dark:text-gray-500">Template</span>
                  <span className="text-gray-900 dark:text-gray-100">{data.useTemplate ? 'Pre-configured folders & system files' : 'Fresh start (empty vault)'}</span>
                </div>
              </div>

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
              <button
                onClick={() => setStep(s => s - 1)}
                className="px-4 py-2 text-xs text-slate-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium cursor-pointer transition-colors"
              >
                ← Back
              </button>
            ) : <div />}

            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(s => s + 1)}
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

        {/* Footer hint */}
        <p className="text-center text-[11px] text-slate-400 dark:text-gray-600 mt-4">
          All settings can be changed later in the Settings panel.
        </p>
      </div>
    </div>
  )
}
