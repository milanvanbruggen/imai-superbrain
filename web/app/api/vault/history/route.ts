import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { listCommits } from '@/lib/vault-history'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (!settings.pat || !settings.owner || !settings.repo) {
    return NextResponse.json({ error: 'GitHub vault not configured' }, { status: 400 })
  }

  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)

  try {
    const commits = await listCommits({
      pat: settings.pat,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch ?? 'main',
    }, 50, page)
    return NextResponse.json({ commits })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 })
  }
}
