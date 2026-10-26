import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient, type VaultClient } from '@/lib/vault-client'
import { runSuggestionReview } from '@/lib/suggestion-review'

// Reading the vault plus the Claude calls can take a few minutes
export const maxDuration = 300

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Checks the preconditions for a run; returns the vault client, or an error response. */
function prepare(): VaultClient | Response {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 })
  }
  try {
    return getVaultClient()
  } catch {
    return NextResponse.json({ error: 'vault_not_configured' }, { status: 422 })
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Weekly Vercel Cron call (see vercel.json); Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Only reviews notes that changed since the last run.
export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const client = prepare()
  if (client instanceof Response) return client
  try {
    return NextResponse.json(await runSuggestionReview(client, new Anthropic()))
  } catch (e: unknown) {
    console.error('AI suggestion review failed:', errorMessage(e))
    return NextResponse.json({ error: 'review_failed', message: errorMessage(e) }, { status: 502 })
  }
}

// Manual run from the Inbox — body { scope: 'changed' | 'all' }.
// Streams newline-delimited JSON: progress events, then { phase: 'done', result } or { phase: 'error', message }.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const fullScan = body?.scope === 'all'
  const client = prepare()
  if (client instanceof Response) return client

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      try {
        const result = await runSuggestionReview(client, new Anthropic(), { fullScan, onProgress: send })
        send({ phase: 'done', result })
      } catch (e: unknown) {
        console.error('AI suggestion review failed:', errorMessage(e))
        send({ phase: 'error', message: errorMessage(e) })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}
