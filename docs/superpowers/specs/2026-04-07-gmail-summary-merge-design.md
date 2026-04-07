# Gmail Summary Merge Design

## Goal

When a new email analysis is made for a person who already has an `## Email context` section in their note, the new emails are merged with the existing context into one unified summary — rather than stacking a second section on top.

## Architecture

Two focused changes to the existing Gmail summarise → append pipeline. The summarise endpoint becomes context-aware (reads the note before calling Claude); the append endpoint becomes idempotent (replaces the section instead of always appending). The modal passes `note.path` to the summarise call.

## Feature: Merge-aware summarisation

### `POST /api/gmail/summarize` changes

- Accept optional `path: string` alongside existing `messageIds` and `personName`
- **Auth:** No additional auth check beyond the existing `getGoogleAccessToken`. The vault read is best-effort and read-only — all failures are silently ignored (see error handling below).
- If `path` is provided and passes basic validation (`path.endsWith('.md')` and `!path.includes('..')`):
  - Attempt to read the note file via `getVaultClient().readFile(path)`
  - If the read throws for any reason (not found, network error, etc.) → silently treat as no existing context; summarisation proceeds normally
  - If the read succeeds: extract the content of the existing `## Email context` section using this logic:
    1. Find the index of the literal string `\n\n## Email context\n\n` in the file content
    2. If found: take the substring from after that marker to the next occurrence of `\n\n##` (start of the next heading) or end of file
    3. `trim()` the extracted substring before use — this strips any trailing newline or whitespace
    4. If the trimmed result is non-empty: treat as existing context
- If `path` validation fails → silently treat as no existing context
- `path` is never required — omitting it produces the same behaviour as today

### Claude prompt change

**When existing context is present** (trimmed, non-empty), the user message becomes:

```
Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staat de bestaande context over {safeName}, gevolgd door {bodies.length} nieuwe e-mails. Schrijf één beknopte, samenhangende contextparagraaf in markdown die de bestaande context integreert met de nieuwe informatie. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

Bestaande context:
{existingContext}

Nieuwe e-mails:
{emailContent}
```

`{bodies.length}` is the count of successfully fetched email bodies (after filtering 404s), matching the existing code's behaviour.

**When no existing context is present**, the prompt is unchanged from today.

### `POST /api/gmail/append` changes

Instead of always appending at the end of the note, the route now replaces the existing `## Email context` section:

- Search for the literal string `\n\n## Email context\n\n` in the note content (exact match, same string the route already writes)
- If found: take `content.slice(0, markerIndex)`, then append `\n\n## Email context\n\n` + `summary.trim()` + `\n`
- If not found: behaviour is identical to today (`content.trimEnd() + '\n\n## Email context\n\n' + summary.trim() + '\n'`)

This handles the edge case of multiple stacked sections from before this change: everything from the first marker onward is replaced, collapsing all prior sections into one.

Notes manually edited in Obsidian may have variant whitespace around the heading. The exact-string match is consistent with what the append route itself writes; notes that were never produced by this route may not match, and will simply be treated as having no prior context (a new section is appended). This is acceptable — correctness is guaranteed for notes written by this app.

### `GmailModal.tsx` changes

- Pass `path: note.path` in the body of the `POST /api/gmail/summarize` request
- No other changes

### Regeneration behaviour

When the user clicks "Opnieuw genereren" (triggers a fresh `doSummarize()` call), the summarise endpoint re-reads the note each time. At this point the note has not yet been updated (append only happens when the user confirms), so the existing context read is the same as on the first call. This is the intended behaviour — no special handling needed.

## Files Affected

| File | Change |
|------|--------|
| `web/app/api/gmail/summarize/route.ts` | Accept `path`, read existing context, merge into Claude prompt |
| `web/app/api/gmail/append/route.ts` | Replace existing `## Email context` section instead of appending |
| `web/components/GmailModal.tsx` | Pass `note.path` to summarise endpoint |
