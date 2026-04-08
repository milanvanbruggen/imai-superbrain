import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { listCommits } from '@/lib/vault-history'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (!settings.pat || !settings.owner || !settings.repo) {
    return NextResponse.json({ error: 'GitHub vault not configured' }, { status: 400 })
  }

  try {
    const commits = await listCommits({
      pat: settings.pat,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch ?? 'main',
    })
    return NextResponse.json({ commits })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 })
  }
}
