# Gmail Summary Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a note already has an `## Email context` section, new email analyses merge with the existing summary instead of creating a second stacked section.

**Architecture:** Two exported pure helpers — `extractEmailContext` (reads existing context from note content) and `replaceEmailContext` (replaces or appends the section) — are added to the existing route files and tested independently. The summarise route reads the note and passes existing context to Claude when present. The append route calls `replaceEmailContext` instead of always appending. The modal passes `note.path` to the summarise endpoint.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Anthropic SDK (`claude-sonnet-4-6`), vitest

---

## File Map

| File | Action |
|------|--------|
| `web/app/api/gmail/summarize/route.ts` | Export `extractEmailContext`; update `POST` to read note + merge prompt |
| `web/app/api/gmail/append/route.ts` | Export `replaceEmailContext`; update `POST` to call it |
| `web/lib/__tests__/gmail-summarize-route.test.ts` | New — tests for `extractEmailContext` |
| `web/lib/__tests__/gmail-append-route.test.ts` | New — tests for `replaceEmailContext` |
| `web/components/GmailModal.tsx` | Pass `path: note.path` in summarise fetch body |

---

## Task 1: `extractEmailContext` pure function + summarise route integration

**Files:**
- Modify: `web/app/api/gmail/summarize/route.ts`
- Create: `web/lib/__tests__/gmail-summarize-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `web/lib/__tests__/gmail-summarize-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractEmailContext } from '@/app/api/gmail/summarize/route'

describe('extractEmailContext', () => {
  it('returns null when section is absent', () => {
    const content = '---\ntitle: Test\n---\n\nSome body.'
    expect(extractEmailContext(content)).toBeNull()
  })

  it('extracts content from existing section', () => {
    const content = '---\ntitle: Test\n---\n\nBody.\n\n## Email context\n\nExisting summary text.'
    expect(extractEmailContext(content)).toBe('Existing summary text.')
  })

  it('stops at the next ## heading', () => {
    const content = 'Intro\n\n## Email context\n\nSummary here.\n\n## Other section\n\nOther content.'
    expect(extractEmailContext(content)).toBe('Summary here.')
  })

  it('returns null when section exists but is empty', () => {
    const content = 'Intro\n\n## Email context\n\n\n\n## Next section'
    expect(extractEmailContext(content)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd web && npx vitest run lib/__tests__/gmail-summarize-route.test.ts 2>&1 | tail -10
```

Expected: FAIL — `extractEmailContext` is not exported

- [ ] **Step 3: Add `extractEmailContext` to the summarise route**

In `web/app/api/gmail/summarize/route.ts`, add this exported function above the `POST` handler:

```ts
const EMAIL_CONTEXT_MARKER = '\n\n## Email context\n\n'

// Exported for testing
export function extractEmailContext(content: string): string | null {
  const markerIdx = content.indexOf(EMAIL_CONTEXT_MARKER)
  if (markerIdx === -1) return null
  const start = markerIdx + EMAIL_CONTEXT_MARKER.length
  const nextHeading = content.indexOf('\n\n##', start)
  const end = nextHeading === -1 ? content.length : nextHeading
  const extracted = content.slice(start, end).trim()
  return extracted.length > 0 ? extracted : null
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd web && npx vitest run lib/__tests__/gmail-summarize-route.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS

- [ ] **Step 5: Update the `POST` handler to read existing context and merge it into the Claude prompt**

In the `POST` function of `web/app/api/gmail/summarize/route.ts`:

1. Destructure `path` from the request body (alongside `messageIds` and `personName`):

```ts
const { messageIds, personName, path } = await req.json()
```

2. After `const emailContent = ...` and before `const client = new Anthropic(...)`, add:

```ts
// Read existing email context from note (best-effort — failures silently ignored)
let existingContext: string | null = null
if (typeof path === 'string' && path.endsWith('.md') && !path.includes('..')) {
  try {
    const vaultClient = getVaultClient()
    const { content: noteContent } = await vaultClient.readFile(path)
    existingContext = extractEmailContext(noteContent)
  } catch {
    // Silently ignore — proceed without existing context
  }
}
```

3. Add the import for `getVaultClient` at the top of the file:

```ts
import { getVaultClient } from '@/lib/vault-client'
```

4. Replace the Claude `content` string with a conditional prompt:

```ts
content: existingContext
  ? `Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staat de bestaande context over ${safeName}, gevolgd door ${bodies.length} nieuwe e-mails. Schrijf één beknopte, samenhangende contextparagraaf in markdown die de bestaande context integreert met de nieuwe informatie. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

Bestaande context:
${existingContext}

Nieuwe e-mails:
${emailContent}`
  : `Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staan ${bodies.length} e-mails die gerelateerd zijn aan ${safeName}. Schrijf een beknopte contextparagraaf in markdown die toegevoegd kan worden aan de notitie over deze persoon. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

E-mails:
${emailContent}`,
```

- [ ] **Step 6: Run full test suite**

```bash
cd web && npx vitest run 2>&1 | tail -8
```

Expected: all tests PASS (86+)

- [ ] **Step 7: Commit**

```bash
git add web/app/api/gmail/summarize/route.ts web/lib/__tests__/gmail-summarize-route.test.ts
git commit -m "feat: summarise route reads existing email context and merges into Claude prompt"
```

---

## Task 2: `replaceEmailContext` pure function + append route integration

**Files:**
- Modify: `web/app/api/gmail/append/route.ts`
- Create: `web/lib/__tests__/gmail-append-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `web/lib/__tests__/gmail-append-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { replaceEmailContext } from '@/app/api/gmail/append/route'

describe('replaceEmailContext', () => {
  it('appends section when none exists', () => {
    const content = '---\ntitle: Test\n---\n\nBody.'
    const result = replaceEmailContext(content, 'New summary.')
    expect(result).toContain('\n\n## Email context\n\nNew summary.\n')
    expect(result).toContain('Body.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('replaces existing section', () => {
    const content = '---\ntitle: Test\n---\n\nBody.\n\n## Email context\n\nOld summary.'
    const result = replaceEmailContext(content, 'New summary.')
    expect(result).toContain('New summary.')
    expect(result).not.toContain('Old summary.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('collapses multiple stacked sections into one', () => {
    const content = 'Intro\n\n## Email context\n\nFirst.\n\n## Email context\n\nSecond.'
    const result = replaceEmailContext(content, 'Merged.')
    expect(result).toContain('Merged.')
    expect(result).not.toContain('First.')
    expect(result).not.toContain('Second.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('trims the summary before writing', () => {
    const content = 'Body.\n\n## Email context\n\nOld.'
    const result = replaceEmailContext(content, '  Padded summary.  ')
    expect(result.endsWith('Padded summary.\n')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd web && npx vitest run lib/__tests__/gmail-append-route.test.ts 2>&1 | tail -10
```

Expected: FAIL — `replaceEmailContext` is not exported

- [ ] **Step 3: Add `replaceEmailContext` to the append route**

In `web/app/api/gmail/append/route.ts`, add this exported function and constant above the `POST` handler:

```ts
const EMAIL_CONTEXT_MARKER = '\n\n## Email context\n\n'

// Exported for testing
export function replaceEmailContext(content: string, summary: string): string {
  const markerIdx = content.indexOf(EMAIL_CONTEXT_MARKER)
  if (markerIdx === -1) {
    return content.trimEnd() + EMAIL_CONTEXT_MARKER + summary.trim() + '\n'
  }
  return content.slice(0, markerIdx) + EMAIL_CONTEXT_MARKER + summary.trim() + '\n'
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd web && npx vitest run lib/__tests__/gmail-append-route.test.ts 2>&1 | tail -10
```

Expected: 4/4 PASS

- [ ] **Step 5: Update the `POST` handler to use `replaceEmailContext`**

In the `POST` function of `web/app/api/gmail/append/route.ts`, replace:

```ts
const appendedContent = content.trimEnd() + '\n\n## Email context\n\n' + summary.trim() + '\n'
```

With:

```ts
const appendedContent = replaceEmailContext(content, summary)
```

- [ ] **Step 6: Run full test suite**

```bash
cd web && npx vitest run 2>&1 | tail -8
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add web/app/api/gmail/append/route.ts web/lib/__tests__/gmail-append-route.test.ts
git commit -m "feat: append route replaces existing email context section instead of stacking"
```

---

## Task 3: Pass `note.path` to summarise endpoint in GmailModal

**Files:**
- Modify: `web/components/GmailModal.tsx`

No unit tests for this task (UI component). Verify by running the full test suite and TypeScript check.

- [ ] **Step 1: Add `path` to the summarise fetch body**

In `web/components/GmailModal.tsx`, find the `doSummarize` function. The current fetch body is:

```ts
body: JSON.stringify({ messageIds: Array.from(selected), personName: note.title }),
```

Change it to:

```ts
body: JSON.stringify({ messageIds: Array.from(selected), personName: note.title, path: note.path }),
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
cd web && npx vitest run 2>&1 | tail -8
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add web/components/GmailModal.tsx
git commit -m "feat: pass note path to summarise endpoint for context-aware merge"
```
