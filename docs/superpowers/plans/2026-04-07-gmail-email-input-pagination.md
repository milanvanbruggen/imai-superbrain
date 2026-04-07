# Gmail Email Input & Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an email input screen before Gmail search and a "Load more" button for paginating results.

**Architecture:** Four independent changes in dependency order: update `listMessages` to support pagination, update the search route to pass `pageToken` through, add a new `update-email` vault endpoint, then wire everything together in `GmailModal`.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Gmail REST API, gray-matter (for frontmatter reading only — body is spliced manually to avoid corruption)

---

## File Map

| File | Action |
|------|--------|
| `web/lib/gmail-client.ts` | Modify `listMessages` signature to return `{ids, nextPageToken?}` and accept optional `pageToken` |
| `web/lib/__tests__/gmail-client.test.ts` | Add tests for updated `listMessages` |
| `web/app/api/gmail/search/route.ts` | Accept `pageToken` in body, pass to `listMessages`, return `nextPageToken` |
| `web/lib/__tests__/gmail-search-route.test.ts` | Add test for `pageToken` passthrough |
| `web/app/api/vault/update-email/route.ts` | New endpoint — splice email into frontmatter and write back atomically |
| `web/lib/__tests__/update-email-route.test.ts` | Tests for `spliceEmailIntoFrontmatter` pure function |
| `web/components/GmailModal.tsx` | New `email-input` phase, `nextPageToken` state, load-more button |

---

## Task 1: Update `listMessages` to support pagination

**Files:**
- Modify: `web/lib/gmail-client.ts`
- Modify: `web/lib/__tests__/gmail-client.test.ts`

- [ ] **Step 1: Write failing tests for the new `listMessages` signature**

Add these tests to `web/lib/__tests__/gmail-client.test.ts` after the existing `buildGmailQuery` describe block:

```ts
import { vi, describe, it, expect, afterEach } from 'vitest'
import { buildGmailQuery, sanitizeQueryTerm, listMessages } from '../gmail-client'

// ... keep existing tests ...

describe('listMessages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ids and nextPageToken when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{ id: 'abc' }, { id: 'def' }],
        nextPageToken: 'token123',
      }),
    }))
    const result = await listMessages('tok', '"test"')
    expect(result.ids).toEqual(['abc', 'def'])
    expect(result.nextPageToken).toBe('token123')
  })

  it('returns empty ids and no nextPageToken when no messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [] }),
    }))
    const result = await listMessages('tok', '"test"')
    expect(result.ids).toEqual([])
    expect(result.nextPageToken).toBeUndefined()
  })

  it('appends pageToken to URL when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    await listMessages('tok', '"test"', 20, 'myToken')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('pageToken=myToken')
  })

  it('throws with status 429 on rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(listMessages('tok', '"test"')).rejects.toMatchObject({ status: 429 })
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd web && npm test -- --reporter=verbose 2>&1 | grep -A 3 "listMessages"
```
Expected: FAIL — `listMessages` return type is `string[]`, not `{ids, nextPageToken?}`

- [ ] **Step 3: Update `listMessages` in `web/lib/gmail-client.ts`**

Replace the current `listMessages` function:

```ts
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd web && npm test -- --reporter=verbose 2>&1 | grep -A 3 "listMessages"
```
Expected: all `listMessages` tests PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/gmail-client.ts web/lib/__tests__/gmail-client.test.ts
git commit -m "feat: listMessages returns nextPageToken and accepts pageToken"
```

---

## Task 2: Update search route to support pagination

**Files:**
- Modify: `web/app/api/gmail/search/route.ts`
- Modify: `web/lib/__tests__/gmail-search-route.test.ts`

- [ ] **Step 1: Write failing test for `pageToken` passthrough**

Add to `web/lib/__tests__/gmail-search-route.test.ts` after existing tests:

```ts
// Note: buildSearchPayload does not deal with pageToken — that's route-level logic.
// The route test file tests the exported pure helper only.
// The pageToken is passed to listMessages which is tested in gmail-client.test.ts.
// No additional unit test needed here — the integration is covered by the client tests.
```

The existing `buildSearchPayload` tests still pass — no change needed there. Mark step complete.

- [ ] **Step 2: Update `web/app/api/gmail/search/route.ts`**

Replace the full file content:

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
```

- [ ] **Step 3: Run all tests — verify nothing broke**

```bash
cd web && npm test
```
Expected: all existing tests PASS (78+)

- [ ] **Step 4: Commit**

```bash
git add web/app/api/gmail/search/route.ts
git commit -m "feat: search route accepts pageToken and returns nextPageToken"
```

---

## Task 3: Create `update-email` endpoint

**Files:**
- Create: `web/app/api/vault/update-email/route.ts`
- Create: `web/lib/__tests__/update-email-route.test.ts`

- [ ] **Step 1: Write failing tests for `spliceEmailIntoFrontmatter`**

Create `web/lib/__tests__/update-email-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { spliceEmailIntoFrontmatter } from '@/app/api/vault/update-email/route'

describe('spliceEmailIntoFrontmatter', () => {
  it('adds email field to existing frontmatter', () => {
    const raw = '---\ntitle: Milan\ntype: person\n---\n\nBody text.'
    const result = spliceEmailIntoFrontmatter(raw, 'milan@example.com')
    expect(result).toContain('email: milan@example.com')
    expect(result).toContain('title: Milan')
    expect(result).toContain('Body text.')
  })

  it('preserves body byte-for-byte', () => {
    const body = '\n\nSome **markdown** body.\n\n[[Wikilink]]  '
    const raw = `---\ntitle: Test\n---${body}`
    const result = spliceEmailIntoFrontmatter(raw, 'test@example.com')
    // Body after closing --- must be identical
    const bodyStart = result.indexOf('---', 4) + 3
    expect(result.slice(bodyStart)).toBe(body)
  })

  it('updates existing email in frontmatter without duplicating', () => {
    const raw = '---\ntitle: Milan\nemail: old@example.com\ntype: person\n---\n\nBody.'
    const result = spliceEmailIntoFrontmatter(raw, 'new@example.com')
    expect(result).toContain('email: new@example.com')
    expect(result).not.toContain('old@example.com')
    expect(result.match(/email:/g)?.length).toBe(1)
  })

  it('handles note with no frontmatter by prepending one', () => {
    const raw = 'Just a body with no frontmatter.'
    const result = spliceEmailIntoFrontmatter(raw, 'test@example.com')
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('email: test@example.com')
    expect(result).toContain(raw)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd web && npm test -- --reporter=verbose 2>&1 | grep -A 3 "spliceEmailIntoFrontmatter"
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `web/app/api/vault/update-email/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

// Exported for testing
export function spliceEmailIntoFrontmatter(raw: string, email: string): string {
  const lines = raw.split('\n')

  // No frontmatter — prepend one
  if (lines[0] !== '---') {
    return `---\nemail: ${email}\n---\n\n${raw}`
  }

  // Find closing ---
  let closingIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      closingIdx = i
      break
    }
  }

  // Malformed (no closing ---) — append email line before a new closing marker
  if (closingIdx === -1) {
    return `${raw.trimEnd()}\nemail: ${email}\n---\n`
  }

  // Replace or add email line inside the frontmatter block
  const fmLines = lines.slice(1, closingIdx)
  const emailIdx = fmLines.findIndex(l => /^email:/.test(l))
  if (emailIdx >= 0) {
    fmLines[emailIdx] = `email: ${email}`
  } else {
    fmLines.push(`email: ${email}`)
  }

  // Rejoin: opening ---, frontmatter lines, then everything from the closing --- onward
  return ['---', ...fmLines, ...lines.slice(closingIdx)].join('\n')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, email } = await req.json()

  if (!path || !email) {
    return NextResponse.json({ error: 'path and email are required' }, { status: 400 })
  }
  if (!path.endsWith('.md') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
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

  const updated = spliceEmailIntoFrontmatter(content, email)

  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
  try {
    await client.writeFile(path, updated, sha, `brain: add email to [[${stem}]]`)
  } catch (err: any) {
    if (err.message?.includes('409') || err.status === 409) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }

  invalidateCache()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd web && npm test -- --reporter=verbose 2>&1 | grep -A 3 "spliceEmailIntoFrontmatter"
```
Expected: all 4 `spliceEmailIntoFrontmatter` tests PASS

- [ ] **Step 5: Run full test suite**

```bash
cd web && npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add web/app/api/vault/update-email/route.ts web/lib/__tests__/update-email-route.test.ts
git commit -m "feat: add update-email endpoint for saving email to note frontmatter"
```

---

## Task 4: Update GmailModal with email-input phase and load more

**Files:**
- Modify: `web/components/GmailModal.tsx`

This task has no unit tests (it's a React component — test by running the app). Follow the spec closely.

- [ ] **Step 1: Update the `Phase` type and add new state**

At the top of `GmailModal.tsx`, change the Phase type and add new state variables:

```tsx
type Phase = 'email-input' | 'loading' | 'results' | 'summarizing' | 'summary' | 'error'
```

Replace the existing state declarations with:

```tsx
const [phase, setPhase] = useState<Phase>(() => note.email ? 'loading' : 'email-input')
const [messages, setMessages] = useState<GmailMessage[]>([])
const [selected, setSelected] = useState<Set<string>>(new Set())
const [summary, setSummary] = useState('')
const [error, setError] = useState('')
const [appending, setAppending] = useState(false)
const [showConsent, setShowConsent] = useState(false)
const [emailInput, setEmailInput] = useState(note.email ?? '')
const [nextPageToken, setNextPageToken] = useState<string | null>(null)
const [loadingMore, setLoadingMore] = useState(false)
```

- [ ] **Step 2: Guard the `useEffect` and update `searchEmails`**

Replace the `useEffect` and `searchEmails` function:

```tsx
useEffect(() => {
  if (note.email) searchEmails(note.email)
}, [])

async function searchEmails(email?: string) {
  setMessages([])
  setNextPageToken(null)
  setPhase('loading')
  setError('')
  try {
    const res = await fetch('/api/gmail/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: note.title, email: email || undefined }),
    })
    if (res.status === 401) { setError('Sessie verlopen — herlaad de pagina.'); setPhase('error'); return }
    if (res.status === 429) { setError('Probeer het over een moment opnieuw.'); setPhase('error'); return }
    if (!res.ok) { setError('Gmail kon niet worden bereikt. Probeer opnieuw.'); setPhase('error'); return }
    const data = await res.json()
    setMessages(data.messages ?? [])
    setNextPageToken(data.nextPageToken ?? null)
    setPhase('results')
  } catch {
    setError('Verbindingsfout. Probeer opnieuw.')
    setPhase('error')
  }
}

async function loadMore() {
  if (!nextPageToken || loadingMore) return
  setLoadingMore(true)
  setError('')
  try {
    const res = await fetch('/api/gmail/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: note.title,
        email: emailInput.trim() || note.email || undefined,
        pageToken: nextPageToken,
      }),
    })
    if (!res.ok) { setError('Meer laden mislukt. Probeer opnieuw.'); return }
    const data = await res.json()
    setMessages(prev => [...prev, ...(data.messages ?? [])])
    setNextPageToken(data.nextPageToken ?? null)
  } catch {
    setError('Verbindingsfout. Probeer opnieuw.')
  } finally {
    setLoadingMore(false)
  }
}
```

- [ ] **Step 3: Add `handleEmailSubmit` function**

Add after `loadMore`:

```tsx
async function handleEmailSubmit() {
  const trimmed = emailInput.trim()
  if (trimmed && trimmed.includes('@')) {
    // Fire-and-forget: save email to note (non-blocking — search starts immediately)
    fetch('/api/vault/update-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: note.path, email: trimmed }),
    }).catch(() => {/* non-critical */})
  }
  searchEmails(trimmed || undefined)
}
```

- [ ] **Step 4: Add `email-input` phase UI to the body section**

In the body `<div className="flex-1 overflow-y-auto p-5">`, add this block right after the `{error && ...}` block and before the `{phase === 'loading' && ...}` block:

```tsx
{phase === 'email-input' && (
  <div className="space-y-4 py-4">
    <p className="text-sm text-slate-500 dark:text-gray-400">
      Voeg het emailadres van <span className="font-medium text-gray-800 dark:text-gray-200">{note.title}</span> toe voor nauwkeurigere resultaten.
    </p>
    <input
      type="email"
      value={emailInput}
      onChange={e => setEmailInput(e.target.value)}
      onKeyDown={e => e.key === 'Enter' && handleEmailSubmit()}
      placeholder="naam@voorbeeld.com"
      autoFocus
      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
    />
  </div>
)}
```

- [ ] **Step 5: Add "Laad meer" button to results phase**

In the results section, after the `{phase === 'results' && messages.length > 0 && ...}` block, add:

```tsx
{phase === 'results' && nextPageToken && (
  <div className="mt-3 flex justify-center">
    <button
      onClick={loadMore}
      disabled={loadingMore}
      className="flex items-center gap-2 text-xs text-teal-600 dark:text-teal-400 hover:underline disabled:opacity-50 cursor-pointer"
    >
      {loadingMore && (
        <div className="w-3 h-3 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
      )}
      {loadingMore ? 'Laden...' : 'Laad meer'}
    </button>
  </div>
)}
```

- [ ] **Step 6: Fix the "Opnieuw proberen" retry button in the error phase**

The existing error phase renders `<button onClick={searchEmails}>Opnieuw proberen</button>`. After the signature change `searchEmails` takes an optional `email?: string`. The React synthetic event would be passed as `email`, producing a wrong query. Change this line to:

```tsx
<button onClick={() => searchEmails(emailInput.trim() || undefined)} className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer">Opnieuw proberen</button>
```

- [ ] **Step 7: Add footer for `email-input` phase**

In the footer `<div className="flex justify-between items-center p-4 ...">`, add a new conditional block at the top (before the `phase === 'results'` block):

```tsx
{phase === 'email-input' && (
  <>
    <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 cursor-pointer">Sluiten</button>
    <button
      onClick={handleEmailSubmit}
      className="px-4 py-2 text-xs bg-teal-600 text-white rounded-md font-medium hover:bg-teal-500 transition-colors cursor-pointer"
    >
      Zoeken
    </button>
  </>
)}
```

- [ ] **Step 8: Verify the component compiles without errors**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors

- [ ] **Step 8: Manual smoke test**

1. Start dev server: `npm run dev`
2. Open a person note without an email → Gmail modal should show email input screen
3. Enter an email, click Zoeken → emails load, note frontmatter gets `email:` field
4. Open a person note that already has an email → modal skips straight to loading
5. Scroll to bottom of results → "Laad meer" appears if more results exist
6. Click "Laad meer" → new emails appended below existing ones

- [ ] **Step 9: Run full test suite**

```bash
cd web && npm test
```
Expected: all tests PASS

- [ ] **Step 10: Commit**

```bash
git add web/components/GmailModal.tsx
git commit -m "feat: add email input step and load more to Gmail modal"
```
