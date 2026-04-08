import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { invalidateCache, getCachedGraphIfAvailable } from '@/lib/graph-cache'
import { resolveVaultSettings, readVaultConfig, writeVaultConfig, isServerless } from '@/lib/vault-config'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  const graph = getCachedGraphIfAvailable()
  const fileConfig = readVaultConfig()

  return NextResponse.json({
    mode: settings.mode,
    vaultPath: settings.vaultPath ?? null,
    owner: settings.owner ?? null,
    repo: settings.repo ?? null,
    branch: settings.branch ?? 'main',
    repoUrl: settings.owner && settings.repo
      ? `https://github.com/${settings.owner}/${settings.repo}`
      : null,
    noteCount: graph?.nodes.length ?? null,
    configSource: fileConfig.mode ? 'file' : 'env',
    syncEnabled: settings.syncEnabled,
    isServerless: isServerless(),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // Legacy: empty POST = invalidate cache
  if (!contentType.includes('application/json')) {
    invalidateCache()
    return NextResponse.json({ ok: true })
  }

  const body = await req.json()
  const { mode, vaultPath, owner, repo, branch, syncEnabled } = body

  const currentConfig = readVaultConfig()

  // Toggle-only: just updating syncEnabled without changing mode
  if (mode === undefined && syncEnabled !== undefined) {
    try {
      writeVaultConfig({ ...currentConfig, syncEnabled })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to save configuration' },
        { status: 500 },
      )
    }
    invalidateCache()
    return NextResponse.json({ ok: true })
  }

  if (mode === 'local') {
    if (!vaultPath || typeof vaultPath !== 'string') {
      return NextResponse.json({ error: 'vaultPath is required for local mode' }, { status: 400 })
    }
    try {
      writeVaultConfig({
        ...currentConfig,
        mode: 'local',
        vaultPath: vaultPath.trim(),
        ...(syncEnabled !== undefined ? { syncEnabled } : {}),
      })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to save configuration' },
        { status: 500 },
      )
    }
  } else if (mode === 'github') {
    if (!owner || !repo || typeof owner !== 'string' || typeof repo !== 'string') {
      return NextResponse.json({ error: 'owner and repo are required for github mode' }, { status: 400 })
    }
    try {
      writeVaultConfig({
        ...currentConfig,
        mode: 'github',
        owner: owner.trim(),
        repo: repo.trim(),
        branch: (branch ?? 'main').trim(),
        ...(syncEnabled !== undefined ? { syncEnabled } : {}),
      })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to save configuration' },
        { status: 500 },
      )
    }
  } else {
    return NextResponse.json({ error: 'mode must be "local" or "github"' }, { status: 400 })
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
