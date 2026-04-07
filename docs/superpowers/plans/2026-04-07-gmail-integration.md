# Gmail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gmail OAuth to the Superbrain web app so users can search their inbox from a person note's detail panel and append an AI-generated summary to the note.

**Architecture:** Google is added as a second NextAuth provider. The Google access/refresh tokens live only in the encrypted NextAuth JWT (never sent to the client). Three server-side API routes handle search (`/api/gmail/search`), summarization (`/api/gmail/summarize`), and atomic note-append (`/api/gmail/append`). A new `GmailModal` component drives the 3-state UI flow. Gmail disconnect is handled by a dedicated `/api/gmail/disconnect` route that re-signs the JWT without Google fields.

**Tech Stack:** Next.js 16 App Router, NextAuth 4.x, Gmail REST API (no SDK), Claude API (`claude-sonnet-4-6`), Vitest, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-07-gmail-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/app/api/auth/[...nextauth]/route.ts` | Modify | Add Google provider + JWT/session callbacks |
| `web/lib/google-auth.ts` | Create | Server-side helper: get Google access token from raw JWT |
| `web/lib/types.ts` | Modify | Add `email?` field to `VaultNote`; add `GmailMessage` type |
| `web/app/api/gmail/search/route.ts` | Create | Search Gmail for emails related to a person note |
| `web/app/api/gmail/summarize/route.ts` | Create | Fetch email bodies + call Claude to generate summary |
| `web/app/api/gmail/append/route.ts` | Create | Atomic fetch-then-write to append summary to note |
| `web/app/api/gmail/disconnect/route.ts` | Create | Re-sign JWT without Google token fields |
| `web/lib/gmail-client.ts` | Create | Typed fetch-based Gmail API wrapper |
| `web/lib/google-token-refresh.ts` | Create | Token refresh helper (extracted for testability) |
| `web/lib/__tests__/google-token-refresh.test.ts` | Create | Unit tests for token refresh logic |
| `web/components/GmailModal.tsx` | Create | 3-state modal: loading → results → summary |
| `web/components/SettingsModal.tsx` | Modify | Add "Integraties" section with Gmail connect/disconnect |
| `web/components/DetailPanel.tsx` | Modify | Add Gmail icon button in header (person nodes only) |
| `web/lib/__tests__/gmail-client.test.ts` | Create | Unit tests for Gmail query builder + sanitizer |
| `web/lib/__tests__/gmail-search-route.test.ts` | Create | Unit tests for search route auth + query logic |
| `vercel.json` | Create | Set 60s timeout on summarize route |

---

## Task 1: Add `email` field to VaultNote type + add GmailMessage type

**Files:**
- Modify: `web/lib/types.ts`

- [ ] **Step 1: Add the fields**

In `web/lib/types.ts`, add `email?: string` to `VaultNote` and add the `GmailMessage` interface at the bottom:

```ts
export interface VaultNote {
  path: string
  stem: string
  title: string
  type: 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area' | 'group' | 'system' | 'template'
  tags: string[]
  date: string | null
  email?: string        // optional email address from frontmatter
  content: string
  relations: TypedRelation[]
  wikilinks: string[]
}

// Add at the bottom of the file:
export interface GmailMessage {
  id: string
  subject: string
  sender: string
  date: string
  snippet: string
}
```

- [ ] **Step 2: Update vault-parser.ts to extract email from frontmatter**

Find the `parseNote` function in `web/lib/vault-parser.ts`. After the existing frontmatter extractions, add:

```ts
const email = typeof data.email === 'string' ? data.email : undefined
```

Include `email` in the returned `VaultNote` object.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
cd web && npm run test
```

Expected: all tests pass (email field is optional, no breaking changes)

- [ ] **Step 4: Commit**

```bash
git add web/lib/types.ts web/lib/vault-parser.ts
git commit -m "feat: add optional email field to VaultNote + GmailMessage type"
```

---

## Task 2: Create `vercel.json` with extended timeout for summarize route

**Files:**
- Create: `vercel.json` (repo root, not inside `web/`)

- [ ] **Step 1: Check whether `vercel.json` already exists at the repo root**

```bash
ls vercel.json 2>/dev/null && echo EXISTS || echo MISSING
```

If it EXISTS, merge the `functions` key into it rather than overwriting. If MISSING, proceed to step 2.

- [ ] **Step 2: Create (or update) `vercel.json`**

```json
{
  "functions": {
    "web/app/api/gmail/summarize/route.ts": {
      "maxDuration": 60
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "chore: set 60s timeout for gmail summarize route"
```

---

## Task 3: Create `web/lib/gmail-client.ts` — Gmail API wrapper

This file wraps the Gmail REST API. No SDK. All auth is passed in as a token string.

**Files:**
- Create: `web/lib/gmail-client.ts`
- Create: `web/lib/__tests__/gmail-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/__tests__/gmail-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildGmailQuery, sanitizeQueryTerm } from '../gmail-client'

describe('sanitizeQueryTerm', () => {
  it('strips Gmail search operators from input', () => {
    expect(sanitizeQueryTerm('foo(bar):baz"qux')).toBe('foobarbazqux')
  })

  it('preserves normal alphanumeric and spaces', () => {
    expect(sanitizeQueryTerm('Milan van Bruggen')).toBe('Milan van Bruggen')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeQueryTerm('')).toBe('')
  })
})

describe('buildGmailQuery', () => {
  it('builds query with name only', () => {
    expect(buildGmailQuery('Milan van Bruggen', undefined)).toBe('"Milan van Bruggen"')
  })

  it('builds query with name and email', () => {
    expect(buildGmailQuery('Milan van Bruggen', 'milan@example.com')).toBe('"Milan van Bruggen" OR "milan@example.com"')
  })

  it('sanitizes inputs before building', () => {
    expect(buildGmailQuery('Foo:Bar', 'a"b@x.com')).toBe('"FooBar" OR "ab@x.com"')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm run test -- gmail-client
```

Expected: FAIL — `gmail-client` module not found

- [ ] **Step 3: Create `web/lib/gmail-client.ts`**

```ts
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
  maxResults = 20
): Promise<string[]> {
  const url = new URL(`${GMAIL_API}/messages`)
  url.searchParams.set('q', query)
  url.searchParams.set('maxResults', String(maxResults))

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 429) throw Object.assign(new Error('Rate limited'), { status: 429 })
  if (!res.ok) throw Object.assign(new Error('Gmail API error'), { status: res.status })

  const data = await res.json()
  return (data.messages ?? []).map((m: { id: string }) => m.id)
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd web && npm run test -- gmail-client
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/gmail-client.ts web/lib/__tests__/gmail-client.test.ts
git commit -m "feat: add Gmail API client with query builder and sanitizer"
```

---

## Task 4: Create `web/lib/google-auth.ts` — server-side token helper

**Files:**
- Create: `web/lib/google-auth.ts`

- [ ] **Step 1: Create the helper**

This helper reads the raw JWT from the request to extract the Google access token. It is used only in server-side API routes (never in client components).

```ts
import { getToken } from 'next-auth/jwt'
import { NextRequest } from 'next/server'

export type GoogleTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: 401 | 403; error: string }

export async function getGoogleAccessToken(req: NextRequest): Promise<GoogleTokenResult> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    return { ok: false, status: 401, error: 'Not authenticated' }
  }

  if (token.google_error === 'RefreshTokenError') {
    return { ok: false, status: 403, error: 'Gmail token refresh failed — please reconnect' }
  }

  if (!token.google_access_token) {
    return { ok: false, status: 403, error: 'Gmail not connected' }
  }

  return { ok: true, accessToken: token.google_access_token as string }
}
```

- [ ] **Step 2: Run existing tests to confirm no import breakage**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add web/lib/google-auth.ts
git commit -m "feat: add server-side Google access token helper"
```

---

## Task 5: Update NextAuth config to add Google provider + JWT callbacks

**Files:**
- Modify: `web/app/api/auth/[...nextauth]/route.ts`

The current file only has the GitHub provider and a `signIn` callback. We need to add:
1. Google provider with `prompt: consent` and `access_type: offline`
2. A `jwt` callback that stores Google tokens and handles refresh
3. A `session` callback that exposes only `googleConnected` and `googleError` — never the token itself

- [ ] **Step 1: Write a test for the JWT token refresh logic**

Create `web/lib/__tests__/google-token-refresh.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the refresh logic by extracting it into a testable function.
// The actual NextAuth callback delegates to this function.
import { refreshGoogleToken } from '@/lib/google-token-refresh'

describe('refreshGoogleToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns new token fields on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        expires_in: 3600,
      }),
    } as Response)

    const result = await refreshGoogleToken('old-refresh-token')
    expect(result.google_access_token).toBe('new-access')
    expect(result.google_error).toBeUndefined()
  })

  it('returns error flag on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response)

    const result = await refreshGoogleToken('bad-refresh-token')
    expect(result.google_error).toBe('RefreshTokenError')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm run test -- google-token-refresh
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `web/lib/google-token-refresh.ts`**

```ts
export async function refreshGoogleToken(refreshToken: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    return { google_error: 'RefreshTokenError' }
  }

  const data = await res.json()
  return {
    google_access_token: data.access_token,
    google_expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    google_error: undefined,
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd web && npm run test -- google-token-refresh
```

Expected: all tests PASS

- [ ] **Step 5: Update `web/app/api/auth/[...nextauth]/route.ts`**

Replace the entire file with:

```ts
import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import { refreshGoogleToken } from '@/lib/google-token-refresh'

const ALLOWED_GITHUB_USER_ID = process.env.ALLOWED_GITHUB_USER_ID ?? ''
// Refresh 60 seconds before actual expiry to avoid mid-flight failures
const REFRESH_BUFFER_SECONDS = 60

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // GitHub: only allow Milan's account
      if (account?.provider === 'github') {
        return String((profile as any).id) === ALLOWED_GITHUB_USER_ID
      }
      // Google: always allow (user must already have a GitHub session to reach settings)
      return true
    },
    async jwt({ token, account }) {
      // Store Google tokens when user connects Google
      if (account?.provider === 'google') {
        return {
          ...token,
          google_access_token: account.access_token,
          google_refresh_token: account.refresh_token,
          google_expires_at: account.expires_at,
          google_error: undefined,
        }
      }

      // Proactively refresh if token expires within REFRESH_BUFFER_SECONDS
      const expiresAt = token.google_expires_at as number | undefined
      if (expiresAt && Date.now() / 1000 > expiresAt - REFRESH_BUFFER_SECONDS) {
        const refreshToken = token.google_refresh_token as string | undefined
        if (refreshToken) {
          const refreshed = await refreshGoogleToken(refreshToken)
          return { ...token, ...refreshed }
        }
      }

      return token
    },
    async session({ session, token }) {
      // ONLY expose connection status — never the token itself
      ;(session as any).googleConnected =
        !!token.google_access_token && token.google_error !== 'RefreshTokenError'
      ;(session as any).googleError = token.google_error ?? null
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

- [ ] **Step 6: Run all tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add web/app/api/auth/[...nextauth]/route.ts web/lib/google-token-refresh.ts web/lib/__tests__/google-token-refresh.test.ts
git commit -m "feat: add Google OAuth provider to NextAuth with token refresh"
```

---

## Task 6: Create `POST /api/gmail/disconnect` route

Disconnecting Gmail requires re-signing the JWT without the Google fields. NextAuth 4.x has no built-in way to do this, so we use the `encode` utility from `next-auth/jwt`.

**Files:**
- Create: `web/app/api/gmail/disconnect/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getToken, encode } from 'next-auth/jwt'

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET
  const token = await getToken({ req, secret })

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Remove all Google fields from the token
  const { google_access_token, google_refresh_token, google_expires_at, google_error, ...rest } = token as any
  const newToken = rest

  // Sign a new JWT and set it as the session cookie
  const encoded = await encode({ token: newToken, secret: secret! })

  const isSecure = req.nextUrl.protocol === 'https:'
  const cookieName = isSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token'

  const response = NextResponse.json({ ok: true })
  response.cookies.set(cookieName, encoded, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })
  return response
}
```

- [ ] **Step 2: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add web/app/api/gmail/disconnect/route.ts
git commit -m "feat: add Gmail disconnect route that re-signs JWT without Google fields"
```

---

## Task 7: Create `POST /api/gmail/search` route

**Files:**
- Create: `web/app/api/gmail/search/route.ts`
- Create: `web/lib/__tests__/gmail-search-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/lib/__tests__/gmail-search-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the query-building logic in isolation
import { buildSearchPayload } from '@/app/api/gmail/search/route'

describe('buildSearchPayload', () => {
  it('uses title and email when both present', () => {
    const query = buildSearchPayload({ title: 'Jan Jansen', email: 'jan@test.com' })
    expect(query).toBe('"Jan Jansen" OR "jan@test.com"')
  })

  it('uses only title when email is missing', () => {
    const query = buildSearchPayload({ title: 'Jan Jansen', email: undefined })
    expect(query).toBe('"Jan Jansen"')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd web && npm run test -- gmail-search-route
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `web/app/api/gmail/search/route.ts`**

```ts
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

  const { title, email } = await req.json()
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const query = buildSearchPayload({ title, email })

  let messageIds: string[]
  try {
    messageIds = await listMessages(tokenResult.accessToken, query, 20)
  } catch (err: any) {
    if (err.status === 429) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Gmail API error' }, { status: 502 })
  }

  if (messageIds.length === 0) {
    return NextResponse.json({ messages: [] })
  }

  // Fetch all metadata in parallel
  const results = await Promise.allSettled(
    messageIds.map(id => getMessageMetadata(tokenResult.accessToken, id))
  )

  const messages = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value)

  return NextResponse.json({ messages })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd web && npm run test -- gmail-search-route
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/app/api/gmail/search/route.ts web/lib/__tests__/gmail-search-route.test.ts
git commit -m "feat: add /api/gmail/search route"
```

---

## Task 8: Create `POST /api/gmail/summarize` route

**Files:**
- Create: `web/app/api/gmail/summarize/route.ts`

- [ ] **Step 1: Confirm `@anthropic-ai/sdk` is installed**

```bash
cd web && node -e "require('@anthropic-ai/sdk')" && echo OK
```

If not installed: `npm install @anthropic-ai/sdk`

- [ ] **Step 2: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken } from '@/lib/google-auth'
import { getMessageBody } from '@/lib/gmail-client'
import Anthropic from '@anthropic-ai/sdk'

const MAX_IDS = 10
const MAX_CHARS = 50_000

export async function POST(req: NextRequest) {
  const tokenResult = await getGoogleAccessToken(req)
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status })
  }

  const { messageIds, personName } = await req.json()
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: 'messageIds is required' }, { status: 400 })
  }

  const ids = messageIds.slice(0, MAX_IDS)

  // Fetch bodies (skip 404s)
  const bodyResults = await Promise.allSettled(
    ids.map(id => getMessageBody(tokenResult.accessToken, id))
  )

  const bodies = bodyResults
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value as string)

  if (bodies.length === 0) {
    return NextResponse.json({ error: 'no_messages' }, { status: 422 })
  }

  // Truncate total content
  const emailContent = bodies.join('\n\n---\n\n').slice(0, MAX_CHARS)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let summary: string
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staan ${bodies.length} e-mails die gerelateerd zijn aan ${personName ?? 'deze persoon'}. Schrijf een beknopte contextparagraaf in markdown die toegevoegd kan worden aan de notitie over deze persoon. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

E-mails:
${emailContent}`,
        },
      ],
    })

    summary = (message.content[0] as any).text ?? ''
  } catch {
    return NextResponse.json({ error: 'Claude API error' }, { status: 502 })
  }

  return NextResponse.json({ summary })
}
```

- [ ] **Step 3: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add web/app/api/gmail/summarize/route.ts
git commit -m "feat: add /api/gmail/summarize route with Claude integration"
```

---

## Task 9: Create `POST /api/gmail/append` route

This route atomically fetches the current note content + SHA, appends the summary, and writes back. Keeping this server-side avoids the client-side race condition.

**Files:**
- Create: `web/app/api/gmail/append/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, summary } = await req.json()
  if (!path || !summary) {
    return NextResponse.json({ error: 'path and summary are required' }, { status: 400 })
  }

  const client = getVaultClient()

  let content: string
  let sha: string
  try {
    const result = await client.readFile(path)
    content = result.content
    sha = result.sha
  } catch {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  }

  const appendedContent = content.trimEnd() + '\n\n## Email context\n\n' + summary.trim() + '\n'

  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
  try {
    await client.writeFile(path, appendedContent, sha, `brain: update [[${stem}]] with email context`)
  } catch (err: any) {
    // GitHub returns 409 on SHA conflict
    if (err.message?.includes('409') || err.status === 409) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add web/app/api/gmail/append/route.ts
git commit -m "feat: add /api/gmail/append route for atomic note enrichment"
```

---

## Task 10: Create `GmailModal` component

**Files:**
- Create: `web/components/GmailModal.tsx`

The modal has three states managed by a `phase` variable: `'loading'` | `'results'` | `'summary'`. It also handles errors inline.

- [ ] **Step 1: Create `web/components/GmailModal.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import { GmailMessage } from '@/lib/types'

interface Props {
  note: { path: string; title: string; email?: string }
  onClose: () => void
  onAppended: () => void
}

type Phase = 'loading' | 'results' | 'summarizing' | 'summary' | 'error'

const CONSENT_KEY = 'gmail_summarize_consent_v1'

export function GmailModal({ note, onClose, onAppended }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [messages, setMessages] = useState<GmailMessage[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [appending, setAppending] = useState(false)
  const [showConsent, setShowConsent] = useState(false)

  useEffect(() => {
    searchEmails()
  }, [])

  async function searchEmails() {
    setPhase('loading')
    setError('')
    try {
      const res = await fetch('/api/gmail/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: note.title, email: note.email }),
      })
      if (res.status === 401) { setError('Sessie verlopen — herlaad de pagina.'); setPhase('error'); return }
      if (res.status === 429) { setError('Probeer het over een moment opnieuw.'); setPhase('error'); return }
      if (!res.ok) { setError('Gmail kon niet worden bereikt. Probeer opnieuw.'); setPhase('error'); return }
      const data = await res.json()
      setMessages(data.messages ?? [])
      setPhase('results')
    } catch {
      setError('Verbindingsfout. Probeer opnieuw.')
      setPhase('error')
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSummarizeClick() {
    const hasConsent = localStorage.getItem(CONSENT_KEY) === 'true'
    if (hasConsent) {
      doSummarize()
    } else {
      setShowConsent(true)
    }
  }

  function handleConsentAccept() {
    localStorage.setItem(CONSENT_KEY, 'true')
    setShowConsent(false)
    doSummarize()
  }

  async function doSummarize() {
    setPhase('summarizing')
    setError('')
    try {
      const res = await fetch('/api/gmail/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: Array.from(selected), personName: note.title }),
      })
      if (res.status === 401) { setError('Sessie verlopen — herlaad de pagina.'); setPhase('error'); return }
      if (res.status === 422) { setError('De geselecteerde emails konden niet worden opgehaald.'); setPhase('results'); return }
      if (!res.ok) { setError('Samenvatting mislukt. Probeer opnieuw.'); setPhase('results'); return }
      const data = await res.json()
      setSummary(data.summary)
      setPhase('summary')
    } catch {
      setError('Verbindingsfout. Probeer opnieuw.')
      setPhase('results')
    }
  }

  async function handleAppend() {
    setAppending(true)
    setError('')
    try {
      const res = await fetch('/api/gmail/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: note.path, summary }),
      })
      if (res.status === 409) { setError('De notitie is tegelijkertijd gewijzigd. Probeer opnieuw.'); return }
      if (!res.ok) { setError('Opslaan mislukt. De samenvatting staat hieronder nog zodat je hem kunt kopiëren.'); return }
      onAppended()
      onClose()
    } catch {
      setError('Verbindingsfout. De samenvatting staat hieronder nog.')
    } finally {
      setAppending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Emails — {note.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Consent notice */}
          {showConsent && (
            <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg text-xs text-amber-800 dark:text-amber-300 space-y-3">
              <p>De inhoud van de geselecteerde emails wordt naar Claude gestuurd om een samenvatting te genereren. Emails worden niet opgeslagen.</p>
              <div className="flex gap-2">
                <button onClick={handleConsentAccept} className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 cursor-pointer">Akkoord</button>
                <button onClick={() => setShowConsent(false)} className="px-3 py-1.5 text-amber-700 dark:text-amber-400 hover:underline text-xs cursor-pointer">Annuleer</button>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
              <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              Zoeken in Gmail...
            </div>
          )}

          {phase === 'summarizing' && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
              <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              Samenvatting genereren...
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 text-center">
              <button onClick={searchEmails} className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">Opnieuw proberen</button>
            </div>
          )}

          {phase === 'results' && messages.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-gray-500 py-8 text-center">Geen emails gevonden voor deze persoon.</p>
          )}

          {phase === 'results' && messages.length > 0 && (
            <div className="space-y-2">
              {messages.map(msg => (
                <label key={msg.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800/50 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.has(msg.id)}
                    onChange={() => toggleSelect(msg.id)}
                    className="mt-0.5 accent-teal-600 cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{msg.subject}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{msg.sender} · {msg.date}</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">{msg.snippet}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {phase === 'summary' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-gray-500 font-medium uppercase tracking-wider">Gegenereerde samenvatting</p>
              <div className="p-4 bg-slate-50 dark:bg-gray-800/50 rounded-lg text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {summary}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-slate-100 dark:border-gray-800 shrink-0">
          {phase === 'results' && (
            <>
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
              <button
                onClick={handleSummarizeClick}
                disabled={selected.size === 0}
                className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Samenvatting genereren ({selected.size})
              </button>
            </>
          )}

          {phase === 'summary' && (
            <>
              <button onClick={() => { setPhase('results'); setSummary('') }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Opnieuw genereren</button>
              <button
                onClick={handleAppend}
                disabled={appending}
                className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {appending ? 'Opslaan...' : 'Toevoegen aan notitie'}
              </button>
            </>
          )}

          {(phase === 'loading' || phase === 'summarizing' || phase === 'error') && (
            <button onClick={onClose} className="ml-auto text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add web/components/GmailModal.tsx
git commit -m "feat: add GmailModal component with 3-state search/summary flow"
```

---

## Task 11: Update `DetailPanel.tsx` — add Gmail button

The Gmail button should appear in the header next to the Edit and Delete buttons. It is only visible when `node.type === 'person'` and `session.googleConnected === true`.

**Files:**
- Modify: `web/components/DetailPanel.tsx`

- [ ] **Step 1: Add session import and Gmail modal state**

At the top of `DetailPanel.tsx`, add:

```ts
import { useSession } from 'next-auth/react'
import { GmailModal } from './GmailModal'
```

Inside the `DetailPanel` function, add:

```ts
const { data: session } = useSession()
const [gmailOpen, setGmailOpen] = useState(false)
```

- [ ] **Step 2: Add the Gmail button to the header**

Find the header section in the expanded panel (where the Edit and Delete buttons are). Add the Gmail button before or after the Edit button, only rendering it when `note?.type === 'person'` and `(session as any)?.googleConnected`:

```tsx
{note?.type === 'person' && (session as any)?.googleConnected && (
  <button
    onClick={() => setGmailOpen(true)}
    title="Zoek emails in Gmail"
    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  </button>
)}
```

If `(session as any)?.googleError === 'RefreshTokenError'`, show the button with an amber warning color and `onClick` opening Settings instead.

- [ ] **Step 3: Render the GmailModal**

At the bottom of the component's JSX return (just before the closing tag):

```tsx
{gmailOpen && note && (
  <GmailModal
    note={{ path: note.path, title: note.title, email: note.email }}
    onClose={() => setGmailOpen(false)}
    onAppended={() => { setGmailOpen(false); onNoteUpdated() }}
  />
)}
```

- [ ] **Step 4: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add web/components/DetailPanel.tsx
git commit -m "feat: add Gmail button to detail panel header for person nodes"
```

---

## Task 12: Update `SettingsModal.tsx` — add Gmail integration section

**Files:**
- Modify: `web/components/SettingsModal.tsx`

- [ ] **Step 1: Add session import and disconnect state**

```ts
import { useSession } from 'next-auth/react'
```

Inside the component:

```ts
const { data: session, update } = useSession()
const [disconnecting, setDisconnecting] = useState(false)
```

- [ ] **Step 2: Add the "Integraties" section to the modal body**

Insert this section inside the `<div className="space-y-4">` block, immediately after the closing `</div>` of the `{/* Sync button */}` section (the last `<div className="flex justify-end pt-1">` block):

```tsx
{/* Integraties */}
<div className="bg-slate-50 dark:bg-gray-800/50 rounded-lg p-4 space-y-3">
  <span className="text-xs text-slate-500 dark:text-gray-500 uppercase tracking-wider font-medium">Integraties</span>

  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
      <span className="text-xs text-gray-700 dark:text-gray-300">Gmail</span>
    </div>

    {(session as any)?.googleConnected ? (
      <button
        onClick={async () => {
          setDisconnecting(true)
          await fetch('/api/gmail/disconnect', { method: 'POST' })
          await update() // refresh session
          setDisconnecting(false)
        }}
        disabled={disconnecting}
        className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50 cursor-pointer transition-colors"
      >
        {disconnecting ? 'Ontkoppelen...' : 'Ontkoppel'}
      </button>
    ) : (
      <a
        href="/api/auth/signin/google"
        className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded font-medium hover:bg-teal-500 transition-colors"
      >
        Koppel Gmail
      </a>
    )}
  </div>

  {(session as any)?.googleError === 'RefreshTokenError' && (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      Gmail-verbinding verlopen.{' '}
      <a href="/api/auth/signin/google" className="underline">Herverbind</a>
    </p>
  )}
</div>
```

- [ ] **Step 3: Run existing tests**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add web/components/SettingsModal.tsx
git commit -m "feat: add Gmail integration section to SettingsModal"
```

---

## Task 13: Add environment variables to `.env.local` and Vercel

- [ ] **Step 1: Add to local `.env.local`**

In `web/.env.local` (or the project root `.env.local`), add:

```
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```

`ANTHROPIC_API_KEY` should already be set. Verify with:

```bash
grep ANTHROPIC_API_KEY web/.env.local || grep ANTHROPIC_API_KEY .env.local || echo "NOT FOUND"
```

If not found, add: `ANTHROPIC_API_KEY=<your-key>`

- [ ] **Step 2: Add to Vercel**

In the Vercel project dashboard → Settings → Environment Variables, add:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ANTHROPIC_API_KEY` (if not already present)

- [ ] **Step 3: Run all tests one final time**

```bash
cd web && npm run test
```

Expected: all tests pass

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: confirm env var setup for Gmail integration"
```

---

## Task 14: Manual end-to-end verification

- [ ] Start dev server: `cd web && npm run dev`
- [ ] Open Settings modal → confirm "Integraties" section appears
- [ ] Click "Koppel Gmail" → Google OAuth flow completes → settings shows "Ontkoppel"
- [ ] Open a person note in the graph → confirm Gmail icon appears in detail panel header
- [ ] Click Gmail icon → modal opens, loading spinner appears
- [ ] Confirm email results load and checkboxes work
- [ ] Select 1-2 emails → click "Samenvatting genereren" → consent notice appears
- [ ] Accept consent → spinner → summary appears
- [ ] Click "Toevoegen aan notitie" → modal closes → note content updated with `## Email context` section
- [ ] Click "Ontkoppel" in settings → Gmail button disappears from detail panel
- [ ] Run full test suite one last time: `cd web && npm run test`
