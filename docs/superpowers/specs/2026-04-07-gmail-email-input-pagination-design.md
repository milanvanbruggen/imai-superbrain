# Gmail Email Input & Pagination Design

## Goal

Two improvements to the Gmail modal: (1) allow adding a person's email address before searching so results are more targeted, and (2) load more emails when the user reaches the bottom of the list.

## Architecture

Two independent changes to the existing Gmail flow. The email input adds a new pre-search phase and a new API endpoint. Pagination threads a `nextPageToken` through the existing search stack.

## Feature 1: Email Input Screen

### Flow

- When the modal opens and `note.email` is empty → show an email input screen instead of immediately searching
- When `note.email` already exists → skip the input screen and search directly (existing behaviour)
- The `useEffect` that calls `searchEmails` on mount is guarded: it only fires when `note.email` already exists. When `note.email` is absent the initial phase is `'email-input'` and no auto-search occurs.
- The input screen shows:
  - Optional email text input (placeholder: `naam@voorbeeld.com`)
  - "Zoeken" button — works with or without email entered
  - "Sluiten" link (same as footer close in other phases)
- On "Zoeken":
  - If an email was entered and passes basic validation (`email.includes('@')`): call `POST /api/vault/update-email`, then search with the email
  - If left empty: search using only the person's name — `update-email` is NOT called, so no empty string is written to frontmatter
  - A fresh search always resets `messages` to `[]` and `nextPageToken` to `null` before the new results arrive

### New endpoint: `POST /api/vault/update-email`

**Request:** `{ path: string, email: string }`

**Validation:**
- `path` must end in `.md` and must not contain `..`
- `email` must be non-empty and contain `@`

**Behaviour:**
1. Read file + SHA from vault client
2. Locate the closing `---` line of the YAML frontmatter block by scanning line by line
3. Replace only the frontmatter block (lines 0 through closing `---`) with a new block that includes `email: <value>` — the body is left byte-for-byte identical
4. Write back using SHA via vault client
5. For the GitHub vault client a SHA conflict surfaces as a 409 error and is returned as-is. The local vault client does not perform SHA conflict detection; writes always succeed (consistent with the existing `append` endpoint behaviour).
6. Invalidate graph cache

**Response:** `{ ok: true }` or error with appropriate status code

### GmailModal changes

- New phase added to `Phase` type: `'email-input'`
- Local `emailInput` state (string) initialised from `note.email ?? ''`
- Initial phase: `'email-input'` when `note.email` is absent, `'loading'` when it exists
- `searchEmails(email?: string)` accepts optional email parameter
- Footer during `email-input` phase: "Zoeken" button (primary) + "Sluiten" link

## Feature 2: Load More (Pagination)

### gmail-client.ts

`listMessages` signature changes to:
```ts
listMessages(accessToken: string, query: string, maxResults?: number, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>
```
The Gmail API response `nextPageToken` field (if present) is returned alongside the ids.

### search/route.ts

- Accepts optional `pageToken: string` in request body
- Passes `pageToken` to `listMessages`
- Returns `nextPageToken` alongside `messages` in the response: `{ messages, nextPageToken? }`

### GmailModal changes

- New state: `nextPageToken: string | null`, initialised to `null`
- A fresh search (from email-input submit or re-search) resets both `messages` to `[]` and `nextPageToken` to `null`
- When results load: append new messages to the existing list; update `nextPageToken` from response (or set to `null` if absent)
- If a "load more" page returns zero messages, `nextPageToken` is set to `null` (hides the button)
- "Laad meer" button is shown only when `phase === 'results'` and `nextPageToken !== null` — this deliberately prevents loading more during `summarizing` or other phases
- While loading more: show a small inline spinner in the button, disable the button; the existing results remain visible
- Loading more does not reset `selected` — previously checked emails stay checked

## Files Affected

| File | Change |
|------|--------|
| `app/api/vault/update-email/route.ts` | New endpoint |
| `app/api/gmail/search/route.ts` | Accept `pageToken`, return `nextPageToken` |
| `lib/gmail-client.ts` | `listMessages` returns `{ids, nextPageToken?}`, accepts `pageToken` |
| `components/GmailModal.tsx` | New `email-input` phase, load-more button, pagination state |
