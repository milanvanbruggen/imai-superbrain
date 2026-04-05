# Second Brain Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Mai Superbrain into a fully operational second brain with 8 note types, template-based note creation, inbox badge, and a CLAUDE.md identity file.

**Architecture:** Extend the existing type union and parser constant to support 3 new note types (meeting, daily, area), add graph colors for each, build a NewNoteModal component that generates frontmatter templates, wire an inbox count API route using the existing graph cache, and commit a CLAUDE.md template to the vault root.

**Tech Stack:** Next.js 16 App Router, TypeScript, React, Tailwind CSS 4, Vitest (tests), gray-matter (frontmatter parsing), existing VaultClient abstraction (GitHub or local filesystem).

**Spec:** `docs/superpowers/specs/2026-04-05-second-brain-setup-design.md`

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `web/lib/types.ts:7` | Extend `VaultNote['type']` union with `meeting`, `daily`, `area` |
| Modify | `web/lib/vault-parser.ts:6` | Add 3 types to `VALID_TYPES` constant |
| Modify | `web/lib/__tests__/vault-parser.test.ts` | Add tests for new types |
| Modify | `web/components/BrainGraph.tsx:17-23` | Add 3 color entries to `TYPE_COLORS` |
| Create | `web/components/NewNoteModal.tsx` | Modal for template-based note creation |
| Modify | `web/app/page.tsx` | Add "+ New Note" button, wire modal + inbox badge |
| Create | `web/app/api/vault/inbox/route.ts` | GET endpoint returning inbox note count |
| Create | `web/lib/__tests__/inbox-route.test.ts` | Unit test for inbox count logic |
| Create | `<vault-root>/CLAUDE.md` | Identity file template for Claude |

---

## Task 1: Extend type union and parser

**Files:**
- Modify: `web/lib/types.ts:7`
- Modify: `web/lib/vault-parser.ts:6`
- Modify: `web/lib/__tests__/vault-parser.test.ts`

- [ ] **Step 1: Write failing tests for new types**

Add to `web/lib/__tests__/vault-parser.test.ts`:

```typescript
it('parses type: meeting', () => {
  const note = parseNote('meetings/standup.md', '---\ntype: meeting\n---\n')
  expect(note.type).toBe('meeting')
})

it('parses type: daily', () => {
  const note = parseNote('daily/2026-04-05.md', '---\ntype: daily\n---\n')
  expect(note.type).toBe('daily')
})

it('parses type: area', () => {
  const note = parseNote('areas/health.md', '---\ntype: area\n---\n')
  expect(note.type).toBe('area')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run lib/__tests__/vault-parser.test.ts
```

Expected: 3 new tests FAIL — `meeting`/`daily`/`area` coerce to `'note'`

- [ ] **Step 3: Update VALID_TYPES in vault-parser.ts**

In `web/lib/vault-parser.ts` line 6, replace:

```typescript
const VALID_TYPES = ['person', 'project', 'idea', 'note', 'resource'] as const
```

With:

```typescript
const VALID_TYPES = ['person', 'project', 'idea', 'note', 'resource', 'meeting', 'daily', 'area'] as const
```

- [ ] **Step 4: Extend the type union in types.ts**

In `web/lib/types.ts` line 7, replace:

```typescript
  type: 'person' | 'project' | 'idea' | 'note' | 'resource'
```

With:

```typescript
  type: 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area'
```

Note: `GraphNode['type']` on line 24 is `VaultNote['type']` — it inherits the change automatically. No separate edit needed.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && npx vitest run lib/__tests__/vault-parser.test.ts
```

Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/lib/vault-parser.ts web/lib/__tests__/vault-parser.test.ts
git commit -m "feat: extend note types with meeting, daily, area"
```

---

## Task 2: Add graph colors for new types

**Files:**
- Modify: `web/components/BrainGraph.tsx:17-23`

No separate test needed — this is a visual mapping with a safe `?? '#94a3b8'` fallback already in place.

- [ ] **Step 1: Add 3 color entries to TYPE_COLORS**

In `web/components/BrainGraph.tsx`, replace the `TYPE_COLORS` object (lines 17-23):

```typescript
const TYPE_COLORS: Record<string, string> = {
  person: '#60a5fa',
  project: '#34d399',
  idea: '#f59e0b',
  resource: '#a78bfa',
  note: '#94a3b8',
  meeting: '#EAB308',
  daily: '#6B7280',
  area: '#EC4899',
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/components/BrainGraph.tsx
git commit -m "feat: add graph colors for meeting, daily, area types"
```

---

## Task 3: Build NewNoteModal component

**Files:**
- Create: `web/components/NewNoteModal.tsx`

This component handles all template generation client-side. It calls the existing `PUT /api/vault/note/[...path]` route.

> **Note:** `authOptions` is imported from a catch-all route file (`@/app/api/auth/[...nextauth]/route`) throughout this codebase — this is an established pattern here. Test files must use **relative imports** (e.g., `'../inbox-utils'`), not `@/` aliases, because Vitest's config has no `resolve.alias` for `@/`.

- [ ] **Step 1: Create the component**

Create `web/components/NewNoteModal.tsx`:

```typescript
'use client'
import { useState } from 'react'

type NoteType = 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area'

const TYPE_FOLDER: Record<NoteType, string> = {
  person: 'people',
  project: 'projects',
  meeting: 'meetings',
  daily: 'daily',
  idea: 'ideas',
  resource: 'resources',
  area: 'areas',
  note: 'inbox',
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function generateFrontmatter(type: NoteType, title: string): string {
  const date = todayISO()
  switch (type) {
    case 'person':
      return `---\ntitle: "${title}"\ntype: person\ntags: []\nrelations: []\n---\n`
    case 'project':
      return `---\ntitle: "${title}"\ntype: project\ndate: ${date}\ntags: []\nstatus: active\nrelations: []\n---\n\n## Doel\n\n## Voortgang\n\n## Open punten\n`
    case 'area':
      return `---\ntitle: "${title}"\ntype: area\ntags: []\nrelations: []\n---\n\n## Beschrijving\n\n## Standaard en doelen\n`
    case 'idea':
      return `---\ntitle: "${title}"\ntype: idea\ndate: ${date}\ntags: []\nrelations: []\n---\n`
    case 'resource':
      return `---\ntitle: "${title}"\ntype: resource\ntags: []\nsource: ""\nrelations: []\n---\n`
    case 'meeting':
      return `---\ntitle: "${title}"\ntype: meeting\ndate: ${date}\ntags: []\nattendees: []\nrelations: []\n---\n\n## Agenda\n\n## Notities\n\n## Actiepunten\n`
    case 'daily':
      return `---\ntitle: ${date}\ntype: daily\ndate: ${date}\ntags: []\n---\n\n## Focus vandaag\n\n## Log\n\n## Reflectie\n`
    case 'note':
    default:
      return `---\ntitle: "${title}"\ntype: note\ntags: []\n---\n`
  }
}

function buildPath(folder: string, type: NoteType, title: string): string {
  if (type === 'daily') {
    // Daily notes: filename is always the date
    return `${folder}/${todayISO()}.md`
  }
  const slug = title.trim().replace(/[/\\:*?"<>|]/g, '-')
  return `${folder}/${slug}.md`
}

interface Props {
  onClose: () => void
  onCreated: (path: string) => void
}

export function NewNoteModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<NoteType>('note')
  const [folder, setFolder] = useState<string>(TYPE_FOLDER['note'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDaily = type === 'daily'
  const effectiveTitle = isDaily ? todayISO() : title
  const path = buildPath(folder, type, effectiveTitle)

  // When type changes, reset folder to the default for that type
  function handleTypeChange(newType: NoteType) {
    setType(newType)
    setFolder(TYPE_FOLDER[newType])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isDaily && !title.trim()) return
    setSaving(true)
    setError(null)

    const content = generateFrontmatter(type, effectiveTitle)

    // For daily notes, check if file already exists — open it instead of creating
    if (type === 'daily') {
      const existing = await fetch(`/api/vault/note/${path}`)
      if (existing.ok) {
        setSaving(false)
        onCreated(path)
        return
      }
    }

    const res = await fetch(`/api/vault/note/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // sha: null signals a new file to the PUT handler
      body: JSON.stringify({ content, sha: null }),
    })

    if (!res.ok) {
      setError('Failed to create note')
      setSaving(false)
      return
    }

    setSaving(false)
    onCreated(path)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-white mb-4">New Note</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Type</label>
            <select
              value={type}
              onChange={e => handleTypeChange(e.target.value as NoteType)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            >
              <option value="note">Note (inbox)</option>
              <option value="idea">Idea</option>
              <option value="project">Project</option>
              <option value="person">Person</option>
              <option value="meeting">Meeting</option>
              <option value="daily">Daily</option>
              <option value="resource">Resource</option>
              <option value="area">Area</option>
            </select>
          </div>

          {!isDaily && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Note title..."
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Folder</label>
            <input
              type="text"
              value={folder}
              onChange={e => setFolder(e.target.value.replace(/^\/+|\/+$/g, ''))}
              disabled={isDaily}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-40"
            />
          </div>

          <p className="text-xs text-gray-500">Will be saved to: <code className="text-gray-400">{path}</code></p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!isDaily && !title.trim())}
              className="px-4 py-2 text-sm bg-white text-black rounded font-medium hover:bg-gray-200 transition disabled:opacity-40"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/components/NewNoteModal.tsx
git commit -m "feat: add NewNoteModal with template-based note creation"
```

---

## Task 4: Wire NewNoteModal into page.tsx

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Add modal state and handlers to page.tsx**

In `web/app/page.tsx`, add the import at the top (after existing imports):

```typescript
import { NewNoteModal } from '@/components/NewNoteModal'
```

Add state inside `BrainPage`:

```typescript
const [showNewNote, setShowNewNote] = useState(false)
```

Add the `handleNoteCreated` callback (insert after the `loadGraph` function):

```typescript
async function handleNoteCreated(path: string) {
  setShowNewNote(false)
  await loadGraph()
  // Select the new note: stem is filename without extension
  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
  setSelectedId(stem.toLowerCase())
}
```

- [ ] **Step 2: Add "+ New Note" button to the header**

In `web/app/page.tsx`, replace the `<header>` block:

```tsx
<header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
  <h1 className="text-sm font-semibold text-white tracking-wide">Superbrain</h1>
  <span className="text-xs text-gray-500">{graph.nodes.length} notes</span>
  <div className="ml-auto flex items-center gap-3">
    <SearchBar nodes={graph.nodes} onSelect={setSelectedId} />
    <button
      onClick={() => setShowNewNote(true)}
      className="px-3 py-1.5 text-xs bg-white text-black rounded font-medium hover:bg-gray-200 transition"
    >
      + New Note
    </button>
  </div>
</header>
```

- [ ] **Step 3: Render the modal**

Add just before the closing `</div>` of the return:

```tsx
{showNewNote && (
  <NewNoteModal
    onClose={() => setShowNewNote(false)}
    onCreated={handleNoteCreated}
  />
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat: wire NewNoteModal into main page"
```

---

## Task 5: Inbox count API route + badge

**Files:**
- Create: `web/app/api/vault/inbox/route.ts`
- Create: `web/lib/__tests__/inbox-route.test.ts`
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Write failing test for inbox count logic**

Create `web/lib/__tests__/inbox-route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { countInboxNodes } from '../inbox-utils'
import type { GraphNode } from '../types'

function makeNode(path: string): GraphNode {
  return { id: path, path, title: path, type: 'note', tags: [], hasDuplicateStem: false }
}

describe('countInboxNodes', () => {
  it('counts nodes with path starting with inbox/', () => {
    const nodes: GraphNode[] = [
      makeNode('inbox/quick-thought.md'),
      makeNode('inbox/another.md'),
      makeNode('people/Milan.md'),
      makeNode('projects/superbrain.md'),
    ]
    expect(countInboxNodes(nodes)).toBe(2)
  })

  it('returns 0 when inbox is empty', () => {
    const nodes: GraphNode[] = [makeNode('people/Milan.md')]
    expect(countInboxNodes(nodes)).toBe(0)
  })

  it('returns 0 for empty node list', () => {
    expect(countInboxNodes([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run lib/__tests__/inbox-route.test.ts
```

Expected: FAIL — `countInboxNodes` not found

- [ ] **Step 3: Create the utility function**

Create `web/lib/inbox-utils.ts`:

```typescript
import type { GraphNode } from './types'

export function countInboxNodes(nodes: GraphNode[]): number {
  return nodes.filter(n => n.path.startsWith('inbox/')).length
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run lib/__tests__/inbox-route.test.ts
```

Expected: ALL 3 tests pass

- [ ] **Step 5: Create the API route**

Create `web/app/api/vault/inbox/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getCachedGraph } from '@/lib/graph-cache'
import { countInboxNodes } from '@/lib/inbox-utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const graph = getCachedGraph()
  if (!graph) return NextResponse.json({ count: 0 })

  return NextResponse.json({ count: countInboxNodes(graph.nodes) })
}
```

- [ ] **Step 6: Add inbox badge to page.tsx**

Add inbox state inside `BrainPage` (after the `showNewNote` state):

```typescript
const [inboxCount, setInboxCount] = useState(0)
const [inboxFilter, setInboxFilter] = useState(false)
```

Add a `loadInboxCount` function (after `handleNoteCreated`):

```typescript
async function loadInboxCount() {
  try {
    const res = await fetch('/api/vault/inbox')
    if (res.ok) {
      const { count } = await res.json()
      setInboxCount(count)
    }
  } catch {
    // non-critical, ignore
  }
}
```

Call it alongside `loadGraph` in `useEffect`:

```typescript
useEffect(() => { loadGraph(); loadInboxCount() }, [])
```

Also call `loadInboxCount()` inside `handleNoteCreated` after `await loadGraph()`.

Add computed filtered nodes (after `selectedNote`):

```typescript
const displayNodes = inboxFilter
  ? graph.nodes.filter(n => n.path.startsWith('inbox/'))
  : graph.nodes
const displayEdges = inboxFilter
  ? graph.edges.filter(e => displayNodes.some(n => n.id === e.source))
  : graph.edges
```

Add inbox badge button to the header (after `+ New Note` button):

```tsx
<button
  onClick={() => setInboxFilter(f => !f)}
  className={`px-3 py-1.5 text-xs rounded font-medium transition flex items-center gap-1.5 ${
    inboxFilter
      ? 'bg-yellow-500 text-black'
      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
  }`}
>
  Inbox
  {inboxCount > 0 && (
    <span className="bg-yellow-500 text-black text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
      {inboxCount}
    </span>
  )}
</button>
```

Update `BrainGraph` to use `displayNodes` and `displayEdges`:

```tsx
<BrainGraph
  nodes={displayNodes}
  edges={displayEdges}
  selectedId={selectedId}
  onSelectNode={setSelectedId}
/>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Run all tests**

```bash
cd web && npx vitest run
```

Expected: ALL tests pass

- [ ] **Step 9: Commit**

```bash
git add web/lib/inbox-utils.ts web/lib/__tests__/inbox-route.test.ts web/app/api/vault/inbox/route.ts web/app/page.tsx
git commit -m "feat: add inbox count API route and badge with graph filter"
```

---

## Task 6: Create CLAUDE.md template in vault root

The vault root is `$VAULT_PATH` in local dev, or the GitHub vault repo root in production.

- [ ] **Step 1: Determine vault path**

```bash
echo $VAULT_PATH
```

If empty, check `web/.env.local` for `VAULT_PATH`. If using GitHub mode, the file should be committed directly to the vault GitHub repo.

- [ ] **Step 2: Create CLAUDE.md in vault root**

Create `$VAULT_PATH/CLAUDE.md` (replace path with actual vault root):

```markdown
# Milan van Bruggen — Second Brain

## Identiteit
<!-- Wie ben je, je rol, expertise, achtergrond -->

## Werkwijze
<!-- Hoe je denkt en werkt, beslissingsstijl, voorkeuren -->

## Schrijfstijl
<!-- Taal (NL/EN per context), toon, structuurvoorkeur -->

## Huidige projecten
<!-- Lijst van actieve projecten met 1-2 zinnen context elk -->

## Vault structuur
De vault gebruikt de PARA-methode:
- `people/` — type: person
- `projects/` — type: project (actieve projecten)
- `areas/` — type: area (verantwoordelijkheden zonder deadline)
- `ideas/` — type: idea
- `resources/` — type: resource (referentiemateriaal)
- `meetings/` — type: meeting (vergadernotities, datum in frontmatter)
- `daily/` — type: daily (dagelijkse log, bestandsnaam = datum)
- `inbox/` — ongesorteerde quick captures, geen type vereist

Wikilinks gebruiken `[[Note Title]]` syntax. Relaties staan in frontmatter:
```yaml
relations:
  - target: "[[Note Title]]"
    type: works_with | part_of | inspired_by | references
```

## Instructies voor Claude
<!-- Wat Claude wel/niet moet doen, hoe notities aangemaakt moeten worden, etc. -->
```

- [ ] **Step 3: Fill in personal content**

Milan fills in Identiteit, Werkwijze, Schrijfstijl, Huidige projecten, and Instructies sections with actual content.

- [ ] **Step 4: Verify Claude Code reads it**

Open a new Claude Code session in the vault directory. Claude should mention or reference the CLAUDE.md context. If Claude Code is run from the app repo instead, no action needed — `$VAULT_PATH/CLAUDE.md` is read when Claude operates on the vault directly.

---

## Final verification

- [ ] Run the full test suite:

```bash
cd web && npx vitest run
```

Expected: ALL tests pass

- [ ] Start the dev server and manually verify:

```bash
cd web && npm run dev
```

Checklist:
- [ ] Graph shows meeting notes in yellow, daily in gray, area in pink
- [ ] "+ New Note" button opens the modal
- [ ] Creating a `meeting` note saves to `meetings/` with correct frontmatter
- [ ] Creating a `daily` note saves to `daily/YYYY-MM-DD.md`; clicking again opens existing
- [ ] Inbox badge shows count; clicking filters graph to inbox notes only
- [ ] `CLAUDE.md` exists in vault root
