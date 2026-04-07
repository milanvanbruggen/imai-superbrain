'use client'
import { useState, useEffect, useRef } from 'react'
import { GmailMessage } from '@/lib/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  note: { path: string; title: string; email?: string }
  onClose: () => void
  onAppended: () => void
}

type Phase = 'email-input' | 'loading' | 'results' | 'summarizing' | 'summary' | 'error'

const CONSENT_KEY = 'gmail_summarize_consent_v1'

export function GmailModal({ note, onClose, onAppended }: Props) {
  const [phase, setPhase] = useState<Phase>(() => note.email ? 'loading' : 'email-input')
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [appending, setAppending] = useState(false)
  const [showConsent, setShowConsent] = useState(false)
  const [emailInput, setEmailInput] = useState(note.email ?? '')
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const currentSearchEmail = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (note.email) searchEmails(note.email)
  }, [])

  async function searchEmails(email?: string) {
    currentSearchEmail.current = email
    setMessages([])
    setNextPageToken(null)
    setPhase('loading')
    setError('')
    try {
      const res = await fetch('/api/gmail/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title, email: email || undefined }),
      })
      if (res.status === 401) { setError('Sessie verlopen — herlaad de pagina.'); setPhase('error'); return }
      if (res.status === 429) { setError('Probeer het over een moment opnieuw.'); setPhase('error'); return }
      if (!res.ok) { setError('Gmail kon niet worden bereikt. Probeer opnieuw.'); setPhase('error'); return }
      const data = await res.json()
      setMessages(data.messages ?? [])
      setNextPageToken(data.nextPageToken ?? null)
      setPhase('results')
    } catch {
      setError('Verbindingsfout. Probeer opnieuw.')
      setPhase('error')
    }
  }

  async function loadMore() {
    if (!nextPageToken || loadingMore) return
    setLoadingMore(true)
    setError('')
    try {
      const res = await fetch('/api/gmail/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: note.title,
          email: currentSearchEmail.current,
          pageToken: nextPageToken,
        }),
      })
      if (!res.ok) { setError('Meer laden mislukt. Probeer opnieuw.'); return }
      const data = await res.json()
      setMessages(prev => [...prev, ...(data.messages ?? [])])
      setNextPageToken(data.nextPageToken ?? null)
    } catch {
      setError('Verbindingsfout. Probeer opnieuw.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleEmailSubmit() {
    const trimmed = emailInput.trim()
    if (trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      // Fire-and-forget: save email to note (non-blocking — search starts immediately)
      fetch('/api/vault/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path, email: trimmed }),
      }).catch(() => {/* non-critical */})
    }
    searchEmails(trimmed || undefined)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSummarizeClick() {
    const hasConsent = localStorage.getItem(CONSENT_KEY) === 'true'
    if (hasConsent) {
      doSummarize()
    } else {
      setShowConsent(true)
    }
  }

  function handleConsentAccept() {
    localStorage.setItem(CONSENT_KEY, 'true')
    setShowConsent(false)
    doSummarize()
  }

  async function doSummarize() {
    setPhase('summarizing')
    setError('')
    try {
      const res = await fetch('/api/gmail/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: Array.from(selected), personName: note.title }),
      })
      if (res.status === 401) { setError('Sessie verlopen — herlaad de pagina.'); setPhase('error'); return }
      if (res.status === 429) { setError('Probeer het over een moment opnieuw.'); setPhase('results'); return }
      if (res.status === 422) { setError('De geselecteerde emails konden niet worden opgehaald.'); setPhase('results'); return }
      if (!res.ok) { setError('Samenvatting mislukt. Probeer opnieuw.'); setPhase('results'); return }
      const data = await res.json()
      setSummary(data.summary)
      setPhase('summary')
    } catch {
      setError('Verbindingsfout. Probeer opnieuw.')
      setPhase('results')
    }
  }

  async function handleAppend() {
    setAppending(true)
    setError('')
    try {
      const res = await fetch('/api/gmail/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path, summary }),
      })
      if (res.status === 409) { setError('De notitie is tegelijkertijd gewijzigd. Probeer opnieuw.'); return }
      if (!res.ok) { setError('Opslaan mislukt. De samenvatting staat hieronder nog zodat je hem kunt kopiëren.'); return }
      onAppended()
      onClose()
    } catch {
      setError('Verbindingsfout. De samenvatting staat hieronder nog.')
    } finally {
      setAppending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Emails — {note.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Consent notice */}
          {showConsent && (
            <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg text-xs text-amber-800 dark:text-amber-300 space-y-3">
              <p>De inhoud van de geselecteerde emails wordt naar Claude gestuurd om een samenvatting te genereren. Emails worden niet opgeslagen.</p>
              <div className="flex gap-2">
                <button onClick={handleConsentAccept} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 cursor-pointer">Akkoord</button>
                <button onClick={() => setShowConsent(false)} className="px-3 py-1.5 text-amber-700 dark:text-amber-400 hover:underline text-xs cursor-pointer">Annuleer</button>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {phase === 'email-input' && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-slate-500 dark:text-gray-400">
                Voeg het emailadres van <span className="font-medium text-gray-800 dark:text-gray-200">{note.title}</span> toe voor nauwkeurigere resultaten.
              </p>
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEmailSubmit()}
                placeholder="naam@voorbeeld.com"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}

          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
              <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              Zoeken in Gmail...
            </div>
          )}

          {phase === 'summarizing' && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
              <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              Samenvatting genereren...
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 text-center">
              <button onClick={() => searchEmails(emailInput.trim() || undefined)} className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">Opnieuw proberen</button>
            </div>
          )}

          {phase === 'results' && messages.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-gray-500 py-8 text-center">Geen emails gevonden voor deze persoon.</p>
          )}

          {phase === 'results' && messages.length > 0 && (
            <div className="space-y-2">
              {messages.map(msg => (
                <label key={msg.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800/50 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.has(msg.id)}
                    onChange={() => toggleSelect(msg.id)}
                    className="mt-0.5 accent-teal-600 cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{msg.subject}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{msg.sender} · {msg.date}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">{msg.snippet}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {phase === 'results' && nextPageToken && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 text-xs text-teal-600 dark:text-teal-400 hover:underline disabled:opacity-50 cursor-pointer"
              >
                {loadingMore && (
                  <div className="w-3 h-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
                )}
                {loadingMore ? 'Laden...' : 'Laad meer'}
              </button>
            </div>
          )}

          {phase === 'summary' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-gray-500 font-medium uppercase tracking-wider">Gegenereerde samenvatting</p>
              <div className="p-4 bg-slate-50 dark:bg-gray-800/50 rounded-lg text-sm text-gray-800 dark:text-gray-200 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-gray-800 shrink-0">
          {phase === 'email-input' && (
            <>
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
              <button
                onClick={handleEmailSubmit}
                className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors cursor-pointer"
              >
                Zoeken
              </button>
            </>
          )}

          {phase === 'results' && (
            <>
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
              <button
                onClick={handleSummarizeClick}
                disabled={selected.size === 0}
                className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Samenvatting genereren ({selected.size})
              </button>
            </>
          )}

          {phase === 'summary' && (
            <>
              <button onClick={() => { setPhase('results'); setSummary('') }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Opnieuw genereren</button>
              <button
                onClick={handleAppend}
                disabled={appending}
                className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {appending ? 'Opslaan...' : 'Toevoegen aan notitie'}
              </button>
            </>
          )}

          {(phase === 'loading' || phase === 'summarizing' || phase === 'error') && (
            <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
          )}
        </div>
      </div>
    </div>
  )
}
