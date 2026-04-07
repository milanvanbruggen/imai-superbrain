# Gmail Email Input & Pagination Design

## Goal

Two improvements to the Gmail modal: (1) allow adding a person's email address before searching so results are more targeted, and (2) load more emails when the user reaches the bottom of the list.

## Architecture

Two independent changes to the existing Gmail flow. The email input adds a new pre-search phase and a new API endpoint. Pagination threads a `nextPageToken` through the existing search stack.

## Feature 1: Email Input Screen

### Flow

- When the modal opens and `note.email` is empty → show an email input screen instead of immediately searching
- When `note.email` already exists → skip the input screen and search directly (existing behaviour)
- The input screen shows:
  - Optional email text input (placeholder: `naam@voorbeeld.com`)
  - "Zoeken" button — works with or without email entered
- On "Zoeken":
  - If an email was entered: call `POST /api/vault/update-email` to persist it to the note's frontmatter, then search using the email
  - If left empty: search using only the person's name (existing fallback)

### New endpoint: `POST /api/vault/update-email`

**Request:** `{ path: string, email: string }`

**Behaviour:**
1. Validate: path must end in `.md`, no `..`, email must be non-empty
2. Read file + SHA from vault client
3. Parse frontmatter with `gray-matter`; set `email` field
4. Reconstruct file: YAML frontmatter + original body
5. Write back atomically using SHA (returns 409 on conflict)
6. Invalidate graph cache

**Response:** `{ ok: true }` or error

### GmailModal changes

- New phase: `'email-input'` — shown as the initial phase when `note.email` is absent
- `note` prop gets a mutable local `email` state initialized from `note.email`
- On submit: call update-email endpoint (if email entered), update local email state, then call `searchEmails(email)`
- `searchEmails` accepts an optional email parameter to support both paths

## Feature 2: Load More (Pagination)

### gmail-client.ts

`listMessages` returns `{ ids: string[], nextPageToken?: string }` instead of `string[]`. Accepts optional `pageToken` parameter to pass to the Gmail API.

### search/route.ts

- Accepts optional `pageToken` in request body
- Passes it to `listMessages`
- Returns `nextPageToken` (if present) alongside `messages` in the response

### GmailModal changes

- Store `nextPageToken: string | null` in state
- When results load: set `nextPageToken` from response; append messages to existing list (not replace) when loading more
- Show "Laad meer" button below the message list when `nextPageToken` is set and phase is `'results'`
- Clicking "Laad meer": fetches next page with current query params + pageToken, appends results, updates `nextPageToken`
- Loading state for the button: show spinner inline, disable button during fetch

## Files Affected

| File | Change |
|------|--------|
| `app/api/vault/update-email/route.ts` | New endpoint |
| `app/api/gmail/search/route.ts` | Accept `pageToken`, return `nextPageToken` |
| `lib/gmail-client.ts` | `listMessages` returns `{ids, nextPageToken?}`, accepts `pageToken` |
| `components/GmailModal.tsx` | New `email-input` phase, load-more button, pagination state |
