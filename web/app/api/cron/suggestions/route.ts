import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { runSuggestionReview } from '@/lib/suggestion-review'

// Two Claude calls over the whole vault index can take a few minutes
export const maxDuration = 300

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function run(fullScan: boolean): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }
  let client
  try {
    client = getVaultClient()
  } catch {
    return NextResponse.json({ error: 'vault_not_configured' }, { status: 422 })
  }
  try {
    const result = await runSuggestionReview(client, new Anthropic(), { fullScan })
    return NextResponse.json(result)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('AI suggestion review failed:', message)
    return NextResponse.json({ error: 'review_failed', message }, { status: 502 })
  }
}

// Weekly Vercel Cron call (see vercel.json); Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Only reviews notes that changed since the last run.
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return run(false)
}

// Manual run from the app — body { scope: 'changed' | 'all' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  return run(body?.scope === 'all')
}
