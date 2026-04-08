import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { invalidateCache, getCachedGraphIfAvailable } from '@/lib/graph-cache'
import { resolveVaultSettings, readVaultConfig, writeVaultConfig, isServerless } from '@/lib/vault-config'
import { existsSync } from 'fs'
import { join } from 'path'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  const graph = getCachedGraphIfAvailable()

  const configSource = existsSync(join(process.cwd(), 'vault-config.json')) ? 'file' : 'env'

  return NextResponse.json({
    mode: settings.mode,
    remote: settings.remote
      ? {
          provider: settings.remote.provider,
          ...(settings.remote.provider === 'github'
            ? { owner: settings.remote.owner, repo: settings.remote.repo, branch: settings.remote.branch ?? 'main' }
            : { url: settings.remote.url, namespace: settings.remote.namespace, project: settings.remote.project, branch: settings.remote.branch ?? 'main' }
          ),
        }
      : null,
    local: settings.local ?? null,
    // Legacy fields for backward compat with components not yet updated
    vaultPath: settings.local?.path ?? null,
    owner: settings.remote?.provider === 'github' ? settings.remote.owner : null,
    repo: settings.remote?.provider === 'github' ? settings.remote.repo : null,
    branch: settings.remote?.branch ?? 'main',
    repoUrl: settings.remote?.provider === 'github'
      ? `https://github.com/${settings.remote.owner}/${settings.remote.repo}`
      : settings.remote?.provider === 'gitlab'
        ? `${settings.remote.url ?? 'https://gitlab.com'}/${settings.remote.namespace}/${settings.remote.project}`
        : null,
    noteCount: graph?.nodes.length ?? null,
    configSource,
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
  const { vaultPath } = body

  if (typeof vaultPath !== 'string') {
    return NextResponse.json({ error: 'vaultPath must be a string' }, { status: 400 })
  }

  const currentConfig = readVaultConfig()

  try {
    writeVaultConfig({
      ...currentConfig,
      local: vaultPath.trim() ? { path: vaultPath.trim() } : undefined,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save configuration' },
      { status: 500 },
    )
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
