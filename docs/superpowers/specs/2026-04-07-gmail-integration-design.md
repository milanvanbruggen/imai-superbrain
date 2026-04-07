# Gmail Integration Design

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Connect Gmail to Superbrain web app so users can enrich person notes with email context

---

## Overview

Users can click a person node in the Superbrain graph and open a Gmail modal that searches their inbox for relevant emails. Found emails can be selected and summarized by Claude, and the summary can be appended to the person note.

---

## Architecture

### Authentication — Google OAuth via NextAuth

Google is added as a second OAuth provider alongside the existing GitHub provider. Users continue to authenticate with GitHub (unchanged). After login, they can connect their Google account from the Settings modal using a dedicated "Koppel Gmail" button.

The Google OAuth flow requests the `gmail.readonly` scope. The resulting access token and refresh token are stored in the encrypted NextAuth JWT session — not in the vault, not in any database. NextAuth handles automatic token refresh via the refresh token.

**Changes:**
- `web/app/api/auth/[...nextauth]/route.ts` — add Google provider with `gmail.readonly` scope; store Google tokens in JWT
- `web/components/SettingsModal.tsx` — add "Integraties" section with Gmail connection status, "Koppel Gmail" and "Ontkoppel Gmail" buttons
- `web/lib/google-auth.ts` (new) — helper to extract Google tokens from the server-side session

### Backend — Two API Routes

**`POST /api/gmail/search`**

- Input: person note object (title, optional email from frontmatter, tags, relations)
- Builds a smart Gmail search query combining name, email address, and relevant tags (e.g. `"Milan van Bruggen" OR "milan@example.com"`)
- Calls Gmail API `users.messages.list` then `users.messages.get` for snippets
- Returns: array of `{ id, subject, sender, date, snippet }`
- Auth: reads Google access token from server-side session; returns 401 if no session, 403 if Gmail not connected

**`POST /api/gmail/summarize`**

- Input: array of Gmail message IDs
- Fetches full email bodies via Gmail API (`users.messages.get` with `format=full`)
- Sends email content to Claude API (`claude-sonnet-4-6`) with a prompt to write a concise markdown context paragraph suitable for appending to a person note
- Returns: generated markdown text
- Auth: same as above

**New files:**
- `web/app/api/gmail/search/route.ts`
- `web/app/api/gmail/summarize/route.ts`
- `web/lib/gmail-client.ts` — fetch-based Gmail API wrapper (no SDK)

### Frontend — Gmail Modal

**Trigger:** A Gmail icon button in the detail panel header, visible only when:
1. The selected node has type `person`
2. Gmail is connected in the session

**Modal — three states:**

1. **Loading** — modal opens immediately and calls `/api/gmail/search` using the current person note's metadata (title, email, tags). Shows a spinner.

2. **Results list** — displays found emails as a list. Each item shows: sender, subject, date, and a short snippet. Each email has a checkbox. Footer buttons: "Samenvatting genereren" (disabled until at least one email selected) and "Sluiten".

3. **Summary review** — shows the generated markdown in a readable preview. Footer buttons: "Toevoegen aan notitie" (appends text to the end of the person note via the existing vault API) and "Opnieuw genereren".

**Changes:**
- `web/components/DetailPanel.tsx` — add Gmail button to header
- `web/components/GmailModal.tsx` (new) — full modal component

---

## Data Flow

```
User clicks Gmail button in detail panel
  → GmailModal opens
  → POST /api/gmail/search (server reads Google token from session)
    → Gmail API: search messages
    → Returns email list to modal
  → User selects emails + clicks "Samenvatting genereren"
  → POST /api/gmail/summarize (server fetches full bodies + calls Claude)
    → Returns markdown summary
  → User clicks "Toevoegen aan notitie"
  → PUT /api/vault/note/{path} (appends summary to person note)
    → GitHub commit created
    → Graph cache invalidated
```

---

## Environment Variables

New variables required:
- `GOOGLE_CLIENT_ID` — Google OAuth app client ID
- `GOOGLE_CLIENT_SECRET` — Google OAuth app client secret
- `ANTHROPIC_API_KEY` — Claude API key (for summarization)

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Gmail not connected | Gmail button hidden; settings shows connect prompt |
| Google token expired | NextAuth auto-refreshes; if refresh fails, show "Herverbind Gmail" message |
| No emails found | Modal shows "Geen emails gevonden voor deze persoon" |
| Gmail API error | Show inline error with retry button |
| Claude API error | Show "Samenvatting mislukt" with retry button |
| Note save fails | Show error; generated summary remains visible so user can copy manually |

---

## Out of Scope

- Sending emails from Superbrain
- Storing emails or email metadata in the vault
- Automatic/scheduled email enrichment (manual trigger only)
- Support for email providers other than Gmail
- Attachments or calendar events
