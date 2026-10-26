'use client'
import { signIn } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', { password, callbackUrl, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError('Incorrect password.')
    } else {
      router.push(callbackUrl)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper text-ink">
      <div className="w-full max-w-sm space-y-8 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src="/brand/ai-superbrain-mark.svg" alt="" width={64} height={64} />
          <div className="space-y-1">
            <h1 className="font-serif text-3xl font-medium">AI Superbrain</h1>
            <p className="text-ink-muted">Your personal archive, with the references in between.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            required
            aria-label="Password"
            className="w-full px-4 py-3 bg-card border border-line-strong rounded-[3px] text-ink placeholder-ink-muted focus:outline-none focus:border-ruling-blue transition"
          />
          {error && <p className="text-sm text-catalog-red">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-bookcloth text-on-bookcloth font-semibold rounded-[3px] hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
