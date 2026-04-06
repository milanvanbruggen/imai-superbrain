import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { invalidateCache, getCachedGraphIfAvailable } from '@/lib/graph-cache'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vaultPath = process.env.VAULT_PATH
  const owner = process.env.GITHUB_VAULT_OWNER
  const repo = process.env.GITHUB_VAULT_REPO
  const branch = process.env.GITHUB_VAULT_BRANCH ?? 'main'

  const graph = getCachedGraphIfAvailable()

  if (vaultPath) {
    return NextResponse.json({
      mode: 'local',
      vaultPath,
      noteCount: graph?.nodes.length ?? null,
    })
  }

  if (owner && repo) {
    return NextResponse.json({
      mode: 'github',
      owner,
      repo,
      branch,
      repoUrl: `https://github.com/${owner}/${repo}`,
      noteCount: graph?.nodes.length ?? null,
    })
  }

  return NextResponse.json({ mode: 'unconfigured' })
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  invalidateCache()
  return NextResponse.json({ ok: true })
}
