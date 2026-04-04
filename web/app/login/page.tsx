'use client'
import { signIn } from 'next-auth/react'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="text-center space-y-6">
        <h1 className="text-3xl font-bold text-white">Superbrain</h1>
        <p className="text-gray-400">Your personal knowledge graph</p>
        <button
          onClick={() => signIn('github', { callbackUrl: '/' })}
          className="px-6 py-3 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-100 transition"
        >
          Sign in with GitHub
        </button>
      </div>
    </main>
  )
}
