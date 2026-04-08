import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { LocalVaultClient } from '@/lib/local'
import { GitHubVaultClient } from '@/lib/github'
import { executeSync, readSnapshot } from '@/lib/vault-sync'
import { invalidateCache } from '@/lib/graph-cache'
import { join } from 'path'

const SNAPSHOT_PATH = join(process.cwd(), 'vault-sync-state.json')

// In-memory lock — valid for single-process local server only (non-Vercel is enforced by syncEnabled check upstream)
let syncInFlight = false

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (!settings.syncEnabled) {
    return NextResponse.json({ ok: false, reason: 'sync_disabled' }, { status: 422 })
  }

  if (syncInFlight) {
    return NextResponse.json({ ok: false, reason: 'sync_in_progress' }, { status: 409 })
  }

  if (!settings.vaultPath || !settings.pat || !settings.owner || !settings.repo) {
    return NextResponse.json({ ok: false, error: 'Sync requires local vault path and GitHub credentials' }, { status: 422 })
  }

  syncInFlight = true
  try {
    const localClient = new LocalVaultClient(settings.vaultPath)
    const remoteClient = new GitHubVaultClient({
      pat: settings.pat,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch,
    })

    const result = await executeSync(localClient, remoteClient, SNAPSHOT_PATH)
    if (result.pushed > 0 || result.pulled > 0 || result.deleted > 0 || result.conflicts > 0) {
      invalidateCache()
    }
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  } finally {
    syncInFlight = false
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  const snapshot = readSnapshot(SNAPSHOT_PATH)

  return NextResponse.json({
    syncEnabled: settings.syncEnabled,
    lastSync: snapshot.lastSync || null,
    fileCount: Object.keys(snapshot.files).length,
  })
}
