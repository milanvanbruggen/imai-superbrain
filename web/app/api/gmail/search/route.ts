import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken } from '@/lib/google-auth'
import { buildGmailQuery, listMessages, getMessageMetadata } from '@/lib/gmail-client'

// Exported for testing
export function buildSearchPayload(params: { title: string; email?: string }): string {
  return buildGmailQuery(params.title, params.email)
}

export async function POST(req: NextRequest) {
  const tokenResult = await getGoogleAccessToken(req)
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status })
  }

  const { title, email, pageToken } = await req.json()
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const query = buildSearchPayload({ title, email })

  let result: { ids: string[]; nextPageToken?: string }
  try {
    result = await listMessages(tokenResult.accessToken, query, 20, pageToken)
  } catch (err: any) {
    if (err.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Gmail API error' }, { status: 502 })
  }

  if (result.ids.length === 0) {
    return NextResponse.json({ messages: [], nextPageToken: null })
  }

  // Fetch all metadata in parallel
  const results = await Promise.allSettled(
    result.ids.map(id => getMessageMetadata(tokenResult.accessToken, id))
  )

  const messages = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value)

  return NextResponse.json({ messages, nextPageToken: result.nextPageToken ?? null })
}
