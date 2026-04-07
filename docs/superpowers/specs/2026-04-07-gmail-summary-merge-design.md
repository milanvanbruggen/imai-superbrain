# Gmail Summary Merge Design

## Goal

When a new email analysis is made for a person who already has an `## Email context` section in their note, the new emails are merged with the existing context into one unified summary — rather than stacking a second section on top.

## Architecture

Two focused changes to the existing Gmail summarise → append pipeline. The summarise endpoint becomes context-aware (reads the note before calling Claude); the append endpoint becomes idempotent (replaces the section instead of always appending). The modal passes `note.path` to the summarise call.

## Feature: Merge-aware summarisation

### `POST /api/gmail/summarize` changes

- Accept optional `path: string` alongside existing `messageIds` and `personName`
- If `path` is provided:
  - Read the note file via the vault client
  - Extract the content of the existing `## Email context` section (if present) — everything between `\n\n## Email context\n\n` and the next `\n\n##` heading or end of file
  - If existing context is found and non-empty, include it in the Claude prompt as prior context to integrate
- If no existing context is found (section absent or empty), the prompt is unchanged from today
- Path validation: must end in `.md` and must not contain `..` — failure is silently ignored (treat as no existing context, so summarisation still proceeds)

### Claude prompt change

When existing context is present, the user message becomes:

```
Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staat de bestaande context over {safeName}, gevolgd door {N} nieuwe e-mails. Schrijf één beknopte, samenhangende contextparagraaf in markdown die de bestaande context integreert met de nieuwe informatie. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

Bestaande context:
{existingContext}

Nieuwe e-mails:
{emailContent}
```

When no existing context is present, the prompt is unchanged from today.

### `POST /api/gmail/append` changes

Instead of always appending at the end of the note, the route now replaces the existing `## Email context` section:

- Split the note content on the first occurrence of `\n\n## Email context\n\n`
- If the marker exists: take everything before it, append `\n\n## Email context\n\n{summary}\n`
- If the marker does not exist: behaviour is identical to today (append at the end)

This handles the edge case of multiple stacked sections from before this change: only everything before the first marker is kept, collapsing all prior sections into one.

### `GmailModal.tsx` changes

- Pass `path: note.path` in the body of the `POST /api/gmail/summarize` request
- No other changes

## Files Affected

| File | Change |
|------|--------|
| `web/app/api/gmail/summarize/route.ts` | Accept `path`, read existing context, merge into Claude prompt |
| `web/app/api/gmail/append/route.ts` | Replace existing `## Email context` section instead of appending |
| `web/components/GmailModal.tsx` | Pass `note.path` to summarise endpoint |
