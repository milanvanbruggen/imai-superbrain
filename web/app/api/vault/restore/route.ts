import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { restoreToCommit } from '@/lib/vault-history'
import { invalidateCache } from '@/lib/graph-cache'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (!settings.pat || !settings.owner || !settings.repo) {
    return NextResponse.json({ error: 'GitHub vault not configured' }, { status: 400 })
  }

  const { sha } = await req.json()
  if (!sha || typeof sha !== 'string') {
    return NextResponse.json({ error: 'sha is required' }, { status: 400 })
  }

  try {
    await restoreToCommit({
      pat: settings.pat,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch ?? 'main',
    }, sha)
    invalidateCache()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })
  }
}
