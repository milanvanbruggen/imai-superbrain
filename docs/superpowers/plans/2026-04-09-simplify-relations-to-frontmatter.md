# Simplify Relations to Frontmatter Only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `<!-- superbrain:related -->` body block; store all UI-managed links in `relations` frontmatter (typed and untyped), and migrate existing notes.

**Architecture:** `TypedRelation.type` becomes optional — a relation without a type is an untyped link. `applyAddRelation` always writes to `relations` frontmatter and never touches the body. `applyRemoveRelation` only removes from frontmatter. `VaultNote.managedLinks` is removed entirely. A one-shot migration route converts existing body blocks to frontmatter.

**Tech Stack:** React, Next.js App Router, gray-matter, Vitest

---

### Task 1: Types + parser — remove managedLinks, make type optional

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/vault-parser.ts`
- Modify: `web/lib/__tests__/vault-parser.test.ts`

**Background:** `VaultNote.managedLinks` currently holds stems from the `<!-- superbrain:related -->` body block. `TypedRelation.type` is currently required and defaults to `'references'` when absent. Both change here.

- [ ] **Step 1: Write failing tests**

Replace the four `describe` blocks that test managed block helpers and `managedLinks` (lines 138–234 of `web/lib/__tests__/vault-parser.test.ts`) with new tests. Also update the import on line 2.

Updated import (line 2):
```ts
import { parseNote, buildGraph, resolveWikilink } from '../vault-parser'
```

New tests to append at the end of the file:
```ts
describe('parseNote - untyped relation', () => {
  it('parses relation without type field as type: undefined', () => {
    const raw = `---
title: Test
relations:
  - target: '[[NoteA]]'
---

Body.`
    const note = parseNote('notes/test.md', raw)
    expect(note.relations).toEqual([{ target: 'NoteA', type: undefined }])
  })

  it('does not set managedLinks on VaultNote', () => {
    const note = parseNote('notes/foo.md', 'just text')
    expect((note as any).managedLinks).toBeUndefined()
  })
})

describe('buildGraph - untyped frontmatter relation', () => {
  it('creates typed:false edge for relation without type', () => {
    const files: [string, string][] = [
      ['people/Milan.md', "---\ntitle: Milan\ntype: person\nrelations:\n  - target: '[[Superbrain]]'\n---\n\n"],
      ['projects/Superbrain.md', '---\ntitle: Superbrain\ntype: project\n---\n\n'],
    ]
    const graph = buildGraph(files)
    const edge = graph.edges.find(e => e.source === 'milan' && e.target === 'superbrain')
    expect(edge).toBeDefined()
    expect(edge!.typed).toBe(false)
    expect(edge!.relationType).toBeUndefined()
  })

  it('suppresses body wikilink when untyped frontmatter relation covers same pair', () => {
    const files: [string, string][] = [
      ['people/Milan.md', "---\ntitle: Milan\ntype: person\nrelations:\n  - target: '[[Superbrain]]'\n---\n\nSee [[Superbrain]]."],
      ['projects/Superbrain.md', '---\ntitle: Superbrain\ntype: project\n---\n\n'],
    ]
    const graph = buildGraph(files)
    const edges = graph.edges.filter(e => e.source === 'milan' && e.target === 'superbrain')
    expect(edges).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/vault-parser.test.ts 2>&1 | tail -20
```

Expected: failures — `managedLinks` still exists on the note, and untyped relation parses with `type: 'references'` (the old default).

- [ ] **Step 3: Update `web/lib/types.ts`**

Replace:
```ts
export interface VaultNote {
  path: string
  stem: string
  title: string
  type: BuiltInNoteType | (string & {})
  tags: string[]
  date: string | null
  email?: string
  content: string
  relations: TypedRelation[]
  wikilinks: string[]
  managedLinks: string[]  // stems from <!-- superbrain:related --> block
}

export interface TypedRelation {
  target: string        // stem of target note
  type: string          // works_with | part_of | inspired_by | references
}
```

With:
```ts
export interface VaultNote {
  path: string
  stem: string
  title: string
  type: BuiltInNoteType | (string & {})
  tags: string[]
  date: string | null
  email?: string
  content: string
  relations: TypedRelation[]
  wikilinks: string[]
}

export interface TypedRelation {
  target: string   // stem of target note
  type?: string    // works_with | part_of | inspired_by | references | undefined = untyped
}
```

- [ ] **Step 4: Update `web/lib/vault-parser.ts`**

**4a.** Remove the three exported helper functions entirely (lines 6–38):
```
export function extractManagedBlock(...)
export function addToManagedBlock(...)
export function removeFromManagedBlock(...)
```

**4b.** In `parseNote`, update the relations mapping (currently around line 64–67):

Replace:
```ts
const relations: TypedRelation[] = (data.relations ?? []).map((r: any) => ({
  target: (r.target as string).replace(/^\[\[|\]\]$/g, ''),
  type: r.type ?? 'references',
}))
```

With:
```ts
const relations: TypedRelation[] = (data.relations ?? [])
  .filter((r: any) => typeof r.target === 'string')
  .map((r: any) => ({
    target: r.target.replace(/^\[\[|\]\]$/g, ''),
    type: typeof r.type === 'string' ? r.type : undefined,
  }))
```

**4c.** In `parseNote`, remove `managedLinks` from the returned object:

Remove this line from the return:
```ts
managedLinks: extractManagedBlock(content),
```

**4d.** In `buildGraph`, update the first loop so untyped frontmatter relations create `typed: false` edges. Find:
```ts
// Add typed edges from frontmatter relations first
for (const note of parsed) {
  const sourceId = note.stem.toLowerCase()
  for (const rel of note.relations) {
    const targetId = resolveWikilink(rel.target, stemIndex)
    if (targetId) {
      edges.push({ source: sourceId, target: targetId, typed: true, relationType: rel.type })
      typedPairs.add(`${sourceId}→${targetId}`)
    }
  }
}
```

Replace with:
```ts
// Add edges from frontmatter relations first (typed if rel.type set, untyped otherwise)
for (const note of parsed) {
  const sourceId = note.stem.toLowerCase()
  for (const rel of note.relations) {
    const targetId = resolveWikilink(rel.target, stemIndex)
    if (targetId) {
      edges.push({ source: sourceId, target: targetId, typed: !!rel.type, relationType: rel.type })
      typedPairs.add(`${sourceId}→${targetId}`)
    }
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/vault-parser.test.ts 2>&1 | tail -20
```

Expected: all tests in vault-parser.test.ts pass (the 4 old managed block describe blocks are removed, new tests pass).

- [ ] **Step 6: TypeScript check**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx tsc --noEmit 2>&1
```

Expected: errors because `DetailPanel.tsx` still references `note.managedLinks` — those are fixed in Task 3. If there are errors elsewhere fix them now.

- [ ] **Step 7: Commit**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && git add lib/types.ts lib/vault-parser.ts lib/__tests__/vault-parser.test.ts && git commit -m "refactor: remove managedLinks, make TypedRelation.type optional, use frontmatter for all relations"
```

---

### Task 2: API helpers — frontmatter only, no body block

**Files:**
- Modify: `web/app/api/vault/note/[...path]/route.ts`
- Modify: `web/lib/__tests__/note-patch-helpers.test.ts`

**Background:** `applyAddRelation` currently writes typed links to frontmatter AND the body block, and untyped links only to the body block. Both now go exclusively to frontmatter. `applyRemoveRelation` currently removes from both frontmatter and body block — now frontmatter only.

- [ ] **Step 1: Rewrite tests in `web/lib/__tests__/note-patch-helpers.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { applySetType, applyAddRelation, applyRemoveRelation } from '@/app/api/vault/note/[...path]/route'

describe('applySetType', () => {
  it('updates type in existing frontmatter', () => {
    const raw = '---\ntitle: Test\ntype: note\n---\n\nBody.'
    const result = applySetType(raw, 'project')
    expect(result).toContain('type: project')
    expect(result).not.toContain('type: note')
    expect(result).toContain('Body.')
  })

  it('adds type when missing from frontmatter', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applySetType(raw, 'idea')
    expect(result).toContain('type: idea')
    expect(result).toContain('Body.')
  })
})

describe('applyAddRelation', () => {
  it('adds typed relation to frontmatter', () => {
    const raw = '---\ntitle: Test\ntype: person\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', 'works_with')
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBe('[[Superbrain]]')
    expect(data.relations[0].type).toBe('works_with')
    expect(result).not.toContain('superbrain:related')
    expect(result).toContain('Body.')
  })

  it('adds untyped link to frontmatter without type field', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', null)
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBe('[[Superbrain]]')
    expect(data.relations[0].type).toBeUndefined()
    expect(result).not.toContain('superbrain:related')
  })

  it('does not duplicate if target already in relations', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyAddRelation(raw, 'Superbrain', 'part_of')
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
  })

  it('does not duplicate when called twice for same target', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const afterFirst = applyAddRelation(raw, 'Superbrain', null)
    const afterSecond = applyAddRelation(afterFirst, 'Superbrain', null)
    const { data } = matter(afterSecond)
    expect(data.relations).toHaveLength(1)
  })
})

describe('applyRemoveRelation', () => {
  it('removes typed relation from frontmatter', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyRemoveRelation(raw, 'Superbrain')
    const { data } = matter(result)
    expect(data.relations).toBeUndefined()
    expect(result).toContain('Body.')
    expect(result).not.toContain('Superbrain')
  })

  it('removes untyped relation from frontmatter', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[NoteA]]'\n---\n\nBody."
    const result = applyRemoveRelation(raw, 'NoteA')
    const { data } = matter(result)
    expect(data.relations).toBeUndefined()
    expect(result).not.toContain('NoteA')
    expect(result).toContain('Body.')
  })

  it('is a no-op when target not in relations', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyRemoveRelation(raw, 'Missing')
    expect(result).toContain('Body.')
    expect(result).not.toContain('Missing')
  })

  it('does not throw when relations array contains a non-string target', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: null\n    type: works_with\n  - target: '[[NoteA]]'\n    type: references\n---\n\nBody."
    expect(() => applyRemoveRelation(raw, 'NoteA')).not.toThrow()
    const { data } = matter(applyRemoveRelation(raw, 'NoteA'))
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/note-patch-helpers.test.ts 2>&1 | tail -20
```

Expected: failures — current `applyAddRelation` still writes managed block, current `applyRemoveRelation` still touches body.

- [ ] **Step 3: Rewrite helpers in `web/app/api/vault/note/[...path]/route.ts`**

**3a.** Remove the import of managed block helpers (line 7):
```ts
import { addToManagedBlock, removeFromManagedBlock } from '@/lib/vault-parser'
```
Delete that line entirely.

**3b.** Replace `applyAddRelation`:

```ts
export function applyAddRelation(raw: string, target: string, relationType: string | null): string {
  const { data, content } = matter(raw)
  const relations: any[] = Array.isArray(data.relations) ? data.relations : []
  const alreadyPresent = relations.some(
    (r: any) => typeof r.target === 'string' && r.target.replace(/^\[\[|\]\]$/g, '') === target
  )
  if (!alreadyPresent) {
    const entry: any = { target: `[[${target}]]` }
    if (relationType) entry.type = relationType
    relations.push(entry)
    data.relations = relations
  }
  return matter.stringify(content, data)
}
```

**3c.** Replace `applyRemoveRelation`:

```ts
export function applyRemoveRelation(raw: string, target: string): string {
  const { data, content } = matter(raw)
  if (Array.isArray(data.relations)) {
    data.relations = (data.relations as any[]).filter(
      (r: any) => !(typeof r.target === 'string' && r.target.replace(/^\[\[|\]\]$/g, '') === target)
    )
    if (data.relations.length === 0) delete data.relations
  }
  return matter.stringify(content, data)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/note-patch-helpers.test.ts 2>&1 | tail -20
```

Expected: all 9 tests pass.

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx tsc --noEmit 2>&1
```

Expected: still errors in `DetailPanel.tsx` about `managedLinks` (fixed next task). No errors in `route.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && git add app/api/vault/note lib/__tests__/note-patch-helpers.test.ts && git commit -m "refactor: simplify add/remove-relation to frontmatter only, remove managed body block"
```

---

### Task 3: DetailPanel — remove managedLinks UI layer

**Files:**
- Modify: `web/components/DetailPanel.tsx`

**Background:** The component currently shows three link categories in the "Links to" section: typed relations (`note.relations`), untyped managed links (`note.managedLinks`), and organic wikilinks. With `managedLinks` gone, UI-added untyped links are now plain `note.relations` entries with `type: undefined`. The component simplifies to two categories: relations (typed or untyped) and organic wikilinks.

- [ ] **Step 1: Update derived vars (no test needed — pure JSX refactor)**

Find these derived vars (currently around lines 217–227):
```ts
const relationTargets = new Set(note ? note.relations.map(r => r.target.toLowerCase()) : [])
const managedLower = new Set(note ? note.managedLinks.map(s => s.toLowerCase()) : [])
const untypedManaged = note ? note.managedLinks.filter(s => !relationTargets.has(s.toLowerCase())) : []
const organicLinks = note ? note.wikilinks.filter(s => !managedLower.has(s.toLowerCase()) && !relationTargets.has(s.toLowerCase())) : []
const linkedStems = new Set([...Array.from(relationTargets), ...Array.from(managedLower)])
const pickerTypes = [...new Set(allNodes.filter(n => n.id !== node?.id).map(n => n.type))].sort()
const pickerNotes = allNodes.filter(n =>
  n.type === pickerType &&
  n.id !== node?.id &&
  !linkedStems.has(n.id)
)
```

Replace with:
```ts
const relationTargets = new Set(note ? note.relations.map(r => r.target.toLowerCase()) : [])
const organicLinks = note ? note.wikilinks.filter(s => !relationTargets.has(s.toLowerCase())) : []
const pickerTypes = [...new Set(allNodes.filter(n => n.id !== node?.id).map(n => n.type))].sort()
const pickerNotes = allNodes.filter(n =>
  n.type === pickerType &&
  n.id !== node?.id &&
  !relationTargets.has(n.id)
)
```

- [ ] **Step 2: Replace the `untypedManaged` list block in JSX**

Find the `untypedManaged.map(stem => ...)` block (currently around lines 459–478):
```tsx
{untypedManaged.map(stem => {
  const targetId = stem.toLowerCase()
  const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
  return (
    <li key={`managed-${stem}`} className="flex items-center gap-2 py-0.5 group">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
        {nodeById[targetId]?.title ?? stem}
      </button>
      <button
        onClick={() => handleRemoveRelation(stem)}
        disabled={removingLink !== null}
        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 disabled:opacity-30"
        title="Remove link"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </li>
  )
})}
```

Delete this entire block. Untyped UI-added links are now entries in `note.relations` with `type: undefined`, so they appear in the `note.relations.map(rel => ...)` block already. The only change needed there is to make the type label conditional.

- [ ] **Step 3: Make the type label conditional in the relations block**

Find in the `note.relations.map(rel => ...)` block:
```tsx
<span className="text-xs text-orange-500/70 shrink-0">{rel.type}</span>
```

Replace with:
```tsx
{rel.type && <span className="text-xs text-orange-500/70 shrink-0">{rel.type}</span>}
```

- [ ] **Step 4: Update the outer list condition**

Find:
```tsx
{(note.relations.length > 0 || untypedManaged.length > 0 || organicLinks.length > 0) && (
```

Replace with:
```tsx
{(note.relations.length > 0 || organicLinks.length > 0) && (
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (except the pre-existing vault-history failure).

- [ ] **Step 7: Commit**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && git add components/DetailPanel.tsx && git commit -m "refactor: simplify DetailPanel links section — remove untypedManaged layer"
```

---

### Task 4: Migration — convert existing body blocks to frontmatter

**Files:**
- Create: `web/app/api/vault/migrate/route.ts`
- Create: `web/lib/__tests__/migrate.test.ts`

**Background:** Notes that already have a `<!-- superbrain:related -->` body block need a one-time migration. This task adds a pure `migrateNote` helper (testable in isolation) and a `POST /api/vault/migrate` endpoint that iterates the entire vault and migrates each affected note.

- [ ] **Step 1: Write failing tests in `web/lib/__tests__/migrate.test.ts`**

Create the file:
```ts
import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { migrateNote } from '@/app/api/vault/migrate/route'

describe('migrateNote', () => {
  it('returns unchanged when no managed block', () => {
    const raw = '---\ntitle: Test\n---\n\nBody text.'
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(false)
    expect(updated).toBe(raw)
  })

  it('moves managed block stems into relations frontmatter', () => {
    const raw = `---
title: Test
---

Body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(true)
    expect(updated).not.toContain('superbrain:related')
    const { data } = matter(updated)
    expect(data.relations).toHaveLength(2)
    expect(data.relations.map((r: any) => r.target)).toContain('[[NoteA]]')
    expect(data.relations.map((r: any) => r.target)).toContain('[[NoteB]]')
    expect(data.relations[0].type).toBeUndefined()
  })

  it('does not duplicate stems already in relations', () => {
    const raw = `---
title: Test
relations:
  - target: '[[NoteA]]'
    type: works_with
---

Body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const { updated } = migrateNote(raw)
    const { data } = matter(updated)
    expect(data.relations).toHaveLength(2)
    const targets = data.relations.map((r: any) => r.target)
    expect(targets.filter((t: string) => t === '[[NoteA]]')).toHaveLength(1)
    expect(targets).toContain('[[NoteB]]')
  })

  it('preserves body text above the block', () => {
    const raw = `---
title: Test
---

First paragraph.
<!-- superbrain:related -->
[[NoteA]]
<!-- /superbrain:related -->`
    const { updated } = migrateNote(raw)
    expect(updated).toContain('First paragraph.')
    expect(updated).not.toContain('superbrain:related')
  })

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Test\r\n---\r\n\r\nBody.\r\n<!-- superbrain:related -->\r\n[[NoteA]]\r\n<!-- /superbrain:related -->'
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(true)
    expect(updated).not.toContain('superbrain:related')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/migrate.test.ts 2>&1 | tail -10
```

Expected: import error — module not found.

- [ ] **Step 3: Create `web/app/api/vault/migrate/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import matter from 'gray-matter'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

export function migrateNote(raw: string): { updated: string; changed: boolean } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const blockRe = /<!-- superbrain:related -->\n([\s\S]*?)\n<!-- \/superbrain:related -->/
  const match = normalized.match(blockRe)
  if (!match) return { updated: raw, changed: false }

  const stems = [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
  const { data, content } = matter(normalized)
  const relations: any[] = Array.isArray(data.relations) ? data.relations : []

  for (const stem of stems) {
    const alreadyPresent = relations.some(
      (r: any) =>
        typeof r.target === 'string' &&
        r.target.replace(/^\[\[|\]\]$/g, '').toLowerCase() === stem.toLowerCase()
    )
    if (!alreadyPresent) {
      relations.push({ target: `[[${stem}]]` })
    }
  }
  if (relations.length > 0) data.relations = relations

  const cleanContent = content.replace(
    /\n*<!-- superbrain:related -->\n[\s\S]*?\n<!-- \/superbrain:related -->/,
    ''
  )
  return { updated: matter.stringify(cleanContent, data), changed: true }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = getVaultClient()
  const tree = await client.getMarkdownTree()

  let migrated = 0
  const errors: string[] = []

  for (const { path } of tree) {
    try {
      const { content: raw, sha } = await client.readFile(path)
      const { updated, changed } = migrateNote(raw)
      if (changed) {
        const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? path
        await client.writeFile(
          path,
          updated,
          sha,
          `brain: migrate [[${stem}]] managed block to relations`
        )
        migrated++
      }
    } catch {
      errors.push(path)
    }
  }

  invalidateCache()
  return NextResponse.json({ migrated, errors })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/migrate.test.ts 2>&1 | tail -20
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (except pre-existing vault-history failure).

- [ ] **Step 6: TypeScript check**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && git add app/api/vault/migrate lib/__tests__/migrate.test.ts && git commit -m "feat: add migration endpoint to convert managed body blocks to relations frontmatter"
```

- [ ] **Step 8: Run the migration**

After deploying / running the dev server, trigger migration once:
```bash
curl -X POST http://localhost:3000/api/vault/migrate \
  -H "Cookie: <your session cookie>" | jq .
```

Expected response: `{ "migrated": N, "errors": [] }` where N is the number of notes that had a managed block.

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Remove `managedLinks` from `VaultNote` | Task 1 |
| Make `TypedRelation.type` optional | Task 1 |
| Remove body block helpers from vault-parser | Task 1 |
| `applyAddRelation` always writes to frontmatter | Task 2 |
| `applyRemoveRelation` only touches frontmatter | Task 2 |
| Untyped frontmatter relations → `typed: false` edge in graph | Task 1 |
| Remove `untypedManaged` layer from DetailPanel | Task 3 |
| Relation type label conditional on `rel.type` | Task 3 |
| Migration converts existing body blocks | Task 4 |

All requirements covered. No placeholders. Type names consistent across tasks (`TypedRelation.type?: string`, `relations: TypedRelation[]`).
