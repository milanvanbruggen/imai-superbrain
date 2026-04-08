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
  if (settings.remote?.provider !== 'github') {
    return NextResponse.json({ error: 'Restore is only available for GitHub vaults' }, { status: 400 })
  }

  const { sha } = await req.json()
  if (!sha || typeof sha !== 'string') {
    return NextResponse.json({ error: 'sha is required' }, { status: 400 })
  }

  const remote = settings.remote
  try {
    await restoreToCommit({
      pat: remote.token,
      owner: remote.owner,
      repo: remote.repo,
      branch: remote.branch ?? 'main',
    }, sha)
    invalidateCache()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })
  }
}
