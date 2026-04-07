import { GmailMessage } from './types'

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me'

// Strip Gmail search operators that could alter query semantics
export function sanitizeQueryTerm(input: string): string {
  return input.replace(/[():"/\\]/g, '')
}

export function buildGmailQuery(name: string, email?: string): string {
  const safeName = sanitizeQueryTerm(name)
  if (!email) return `"${safeName}"`
  const safeEmail = sanitizeQueryTerm(email)
  return `"${safeName}" OR "${safeEmail}"`
}

export async function listMessages(
  accessToken: string,
  query: string,
  maxResults = 20,
  pageToken?: string
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const url = new URL(`${GMAIL_API}/messages`)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(maxResults))
  if (pageToken) url.searchParams.set('pageToken', pageToken)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 429) throw Object.assign(new Error('Rate limited'), { status: 429 })
  if (!res.ok) throw Object.assign(new Error('Gmail API error'), { status: res.status })

  const data = await res.json()
  return {
    ids: (data.messages ?? []).map((m: { id: string }) => m.id),
    nextPageToken: data.nextPageToken,
  }
}

export async function getMessageMetadata(
  accessToken: string,
  id: string
): Promise<GmailMessage> {
  const url = `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw Object.assign(new Error('Gmail API error'), { status: res.status })

  const data = await res.json()
  const headers: { name: string; value: string }[] = data.payload?.headers ?? []
  const get = (name: string) => headers.find(h => h.name === name)?.value ?? ''

  return {
    id,
    subject: get('Subject') || '(no subject)',
    sender: get('From'),
    date: get('Date'),
    snippet: data.snippet ?? '',
  }
}

export async function getMessageBody(
  accessToken: string,
  id: string
): Promise<string | null> {
  const url = `${GMAIL_API}/messages/${id}?format=full`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw Object.assign(new Error('Gmail API error'), { status: res.status })

  const data = await res.json()
  return extractTextFromPayload(data.payload)
}

function extractTextFromPayload(payload: any): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextFromPayload(part)
      if (text) return text
    }
  }
  return ''
}
