import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { listCommits } from '@/lib/vault-history'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (settings.remote?.provider !== 'github') {
    return NextResponse.json({ error: 'History is only available for GitHub vaults' }, { status: 400 })
  }

  const remote = settings.remote
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)

  try {
    const commits = await listCommits({
      pat: remote.token,
      owner: remote.owner,
      repo: remote.repo,
      branch: remote.branch ?? 'main',
    }, 50, page)
    return NextResponse.json({ commits })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 })
  }
}
