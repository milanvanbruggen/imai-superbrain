# Gmail Integration Design

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Connect Gmail to Superbrain web app so users can enrich person notes with email context

---

## Overview

Users can click a person node in the Superbrain graph and open a Gmail modal that searches their inbox for relevant emails. Found emails can be selected and summarized by Claude, and the summary can be appended to the person note. Email content is never persisted — not to the vault, not to logs, not to any storage.

---

## Architecture

### Authentication — Google OAuth via NextAuth

Google is added as a second OAuth provider alongside the existing GitHub provider. Users continue to authenticate with GitHub (unchanged). After login, they can connect their Google account from the Settings modal using a dedicated "Koppel Gmail" button.

The Google OAuth flow requests the `gmail.readonly` scope. The resulting `access_token`, `refresh_token`, and `expires_at` are stored in the encrypted NextAuth JWT — not in the vault, not in any database. They are explicitly **not** forwarded to the client-side session object (i.e. not included in the `session` callback return value), so they never reach the browser.

**Token refresh:** NextAuth 4.x does not auto-refresh tokens. The `jwt` callback must manually check `expires_at` and call Google's token endpoint (`https://oauth2.googleapis.com/token`) when the token is expired. Refresh is triggered 60 seconds early to avoid mid-flight expiry. If the refresh fails (e.g. user revoked access), the callback sets a `google_error: 'RefreshTokenError'` flag in the JWT so the UI can show a "Herverbind Gmail" prompt.

**JWT callback shape (pseudocode):**
```ts
callbacks: {
  jwt({ token, account }) {
    if (account?.provider === 'google') {
      token.google_access_token = account.access_token
      token.google_refresh_token = account.refresh_token
      token.google_expires_at = account.expires_at
    }
    // Refresh if expired
    if (Date.now() / 1000 > (token.google_expires_at ?? 0)) {
      // call Google token endpoint, update token fields
      // on failure: token.google_error = 'RefreshTokenError'
    }
    return token
  },
  session({ session, token }) {
    // Only expose connection status — never expose the token itself
    session.googleConnected = !!token.google_access_token && !token.google_error
    session.googleError = token.google_error ?? null
    return session
  }
}
```

**Google Cloud Console prerequisites:**
- Enable the Gmail API in the Google Cloud project
- Configure OAuth consent screen with `gmail.readonly` scope
- Add authorized redirect URI: `https://<production-domain>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local dev)
- Set `prompt: 'consent'` and `access_type: 'offline'` in the Google provider config to ensure a refresh token is always issued, even if the user has previously authorized the app without the Gmail scope

**Changes:**
- `web/app/api/auth/[...nextauth]/route.ts` — add Google provider; implement `jwt` callback with token refresh logic
- `web/components/SettingsModal.tsx` — add "Integraties" section with Gmail connection status, "Koppel Gmail" and "Ontkoppel Gmail" buttons. "Ontkoppel Gmail" calls `POST /api/gmail/disconnect`, which signs a new JWT with `google_access_token`, `google_refresh_token`, and `google_expires_at` removed, then sets it as the new session cookie — effectively clearing the Google connection from the stateless JWT.
- `web/app/api/gmail/disconnect/route.ts` (new) — clears Google token fields from the JWT session
- `web/lib/google-auth.ts` (new) — server-side helper that reads `google_access_token` from the raw JWT via `getToken({ req, secret: process.env.NEXTAUTH_SECRET, raw: false })`. Note: `raw: false` returns the decoded JWT object; `secret` must match `NEXTAUTH_SECRET`.

### Backend — Two API Routes

**`POST /api/gmail/search`**

- Input: person note object (title, optional email from frontmatter, tags, relations)
- Sanitizes all user-controlled fields (strips Gmail search operators: `(`, `)`, `:`, `"`, etc.) before building the query
- Builds a Gmail search query: `"<name>" OR "<email>"` (tags excluded from query to avoid over-filtering)
- Calls Gmail API `users.messages.list` with `maxResults: 20` (no pagination — first 20 results are sufficient for manual enrichment)
- Fetches snippet + metadata for each via `users.messages.get` with `format=metadata`
- Returns: array of `{ id, subject, sender, date, snippet }`
- Auth: reads Google access token server-side via `google-auth.ts`; returns 401 if no session, 403 if Gmail not connected or token refresh failed

**`POST /api/gmail/summarize`**

- Input: array of Gmail message IDs (max 10)
- Fetches full email bodies via `users.messages.get` with `format=full`; if a message is missing (deleted/moved), it is silently skipped — the summary is generated from whatever messages were successfully fetched; if all messages fail, returns 422
- Truncates total email content to 50,000 characters before sending to Claude to stay within token limits and Vercel timeout
- Before calling Claude: modal shows a one-time consent notice — "De inhoud van de geselecteerde emails wordt naar Claude gestuurd om een samenvatting te genereren. Emails worden niet opgeslagen."
- Sends email content to Claude API (`claude-sonnet-4-6`) with a prompt to write a concise markdown context paragraph suitable for appending to a person note
- Returns: generated markdown text
- Function timeout: 60 seconds (configured in `vercel.json`)
- Auth: same as above; returns 401/403 on session expiry mid-flow

**New files:**
- `web/app/api/gmail/search/route.ts` — note: fetches 20 message IDs + 20 metadata calls in parallel (`Promise.all`) to stay within Vercel's default 10s timeout; no extended timeout needed
- `web/app/api/gmail/summarize/route.ts`
- `web/app/api/gmail/append/route.ts`
- `web/lib/gmail-client.ts` — fetch-based Gmail API wrapper (no SDK)

**`vercel.json` change:**
```json
{
  "functions": {
    "web/app/api/gmail/summarize/route.ts": { "maxDuration": 60 }
  }
}
```

### Frontend — Gmail Modal

**Trigger:** A Gmail icon button in the detail panel header, visible only when:
1. The selected node has type `person`
2. `session.googleConnected === true`

If `session.googleError === 'RefreshTokenError'`, the button is shown with a warning indicator and clicking it opens Settings instead of the modal.

**Modal — three states:**

1. **Loading** — modal opens immediately and calls `/api/gmail/search` using the current person note's metadata (title, email from frontmatter). Shows a spinner.

2. **Results list** — displays up to 20 found emails. Each item shows: sender, subject, date, and a short snippet. Each email has a checkbox. Footer buttons: "Samenvatting genereren" (disabled until at least one email selected) and "Sluiten". If zero results: "Geen emails gevonden voor deze persoon."

3. **Summary review** — before calling `/api/gmail/summarize`, shows a one-time consent notice (dismissable, remembered in `localStorage`). After consent, shows a spinner, then displays the generated markdown in a readable preview. Footer buttons: "Toevoegen aan notitie" and "Opnieuw genereren". Session expiry during this step (401 response) shows "Sessie verlopen — herlaad de pagina."

**"Toevoegen aan notitie" flow:**
The frontend calls `POST /api/gmail/append` with the note path and the generated summary text. This API route (server-side) fetches the current note content + SHA via the vault API, appends the summary as a new `## Email context` section, then writes back via the vault API in the same request. Keeping fetch-and-write inside a single server-side route eliminates the client-side race window. GitHub's SHA requirement provides a final safety net: if a concurrent write happens between fetch and write, GitHub rejects the PUT with a 409 and the route returns an error to the modal.

**Changes:**
- `web/components/DetailPanel.tsx` — add Gmail button to header
- `web/components/GmailModal.tsx` (new) — full modal component
- `web/app/api/gmail/append/route.ts` (new) — atomic fetch-then-write for appending summary to a note

---

## Data Flow

```
User clicks Gmail button in detail panel
  → GmailModal opens
  → POST /api/gmail/search (server reads Google token from JWT via getToken)
    → Sanitize + build Gmail query
    → Gmail API: list messages (max 20)
    → Fetch snippets for each message
    → Returns email list to modal
  → User selects emails + clicks "Samenvatting genereren"
  → Consent notice shown (one-time, stored in localStorage)
  → POST /api/gmail/summarize (max 10 emails, 50k char limit)
    → Gmail API: fetch full bodies (skip missing messages)
    → Claude API: generate markdown summary
    → Returns markdown text to modal
  → User clicks "Toevoegen aan notitie"
  → POST /api/gmail/append (server fetches note + SHA, appends summary, writes back)
    → GitHub commit created (cache invalidated automatically on next graph request)
    → On SHA conflict (409): modal shows error, user can retry
```

---

## Environment Variables

New variables:
- `GOOGLE_CLIENT_ID` — Google OAuth app client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth app client secret

Existing (already required for other features):
- `ANTHROPIC_API_KEY` — Claude API key

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Gmail not connected | Gmail button hidden in detail panel |
| Token refresh failed | Gmail button shows warning; click opens Settings |
| Session expired mid-flow | Modal shows "Sessie verlopen — herlaad de pagina" |
| No emails found | Modal shows "Geen emails gevonden voor deze persoon" |
| Some messages missing (deleted/moved) | Skipped silently; summary generated from remaining |
| All messages missing | Returns 422; modal shows error with retry button |
| Gmail API rate limit (429) | Modal shows "Probeer het over een moment opnieuw" with retry button |
| Gmail API error | Modal shows inline error with retry button |
| Claude API error or timeout | Modal shows "Samenvatting mislukt" with retry button |
| Note save fails | Modal shows error; generated summary stays visible for manual copy |

---

## Out of Scope

- Sending emails from Superbrain
- Storing emails or email metadata in the vault or any log
- Automatic/scheduled email enrichment (manual trigger only)
- Support for email providers other than Gmail
- Attachments or calendar events
- Pagination beyond the first 20 search results
