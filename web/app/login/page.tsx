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
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold text-white">Superbrain</h1>
          <p className="text-gray-400">Your personal knowledge graph</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            required
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 transition"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-500 disabled:opacity-50 transition cursor-pointer"
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
