# Visual Relation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to change a note's type and add/remove links to other notes directly from the DetailPanel sidebar, without editing the markdown file manually.

**Architecture:** Three new PATCH operations on the note API (`set-type`, `add-relation`, `remove-relation`) write pure transformations on the raw note file. A managed HTML comment block at the end of each note body (`<!-- superbrain:related -->`) stores UI-added wikilinks — readable by Obsidian natively, cleanly separable from organic body prose. The DetailPanel gains an inline type picker and a link management section with a browse-by-type note picker.

**Tech Stack:** React (useState, useEffect), Next.js API routes, gray-matter, Vitest

---

### Task 1: Parser helpers + `managedLinks` field

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/vault-parser.ts`
- Modify: `web/lib/__tests__/vault-parser.test.ts`

The managed block format lives at the end of the note body:
```
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->
```

- [ ] **Step 1: Add `managedLinks` to `VaultNote`**

In `web/lib/types.ts`, add `managedLinks: string[]` after `wikilinks`:

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
```

- [ ] **Step 2: Write failing tests for managed block helpers**

Append to `web/lib/__tests__/vault-parser.test.ts`:

```ts
import { extractManagedBlock, addToManagedBlock, removeFromManagedBlock } from '../vault-parser'

describe('extractManagedBlock', () => {
  it('returns empty array when no block present', () => {
    expect(extractManagedBlock('just some text')).toEqual([])
  })

  it('extracts stems from managed block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Note1]] [[Note2]]\n<!-- /superbrain:related -->'
    expect(extractManagedBlock(content)).toEqual(['Note1', 'Note2'])
  })

  it('returns empty array for empty block', () => {
    const content = '<!-- superbrain:related -->\n\n<!-- /superbrain:related -->'
    expect(extractManagedBlock(content)).toEqual([])
  })
})

describe('addToManagedBlock', () => {
  it('creates block when none exists', () => {
    const result = addToManagedBlock('some content', 'NewNote')
    expect(result).toContain('<!-- superbrain:related -->')
    expect(result).toContain('[[NewNote]]')
    expect(result).toContain('<!-- /superbrain:related -->')
    expect(result).toContain('some content')
  })

  it('appends to existing block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Existing]]\n<!-- /superbrain:related -->'
    const result = addToManagedBlock(content, 'NewNote')
    expect(result).toContain('[[Existing]]')
    expect(result).toContain('[[NewNote]]')
  })

  it('does not duplicate if stem already present', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Note]]\n<!-- /superbrain:related -->'
    const result = addToManagedBlock(content, 'Note')
    expect(result.match(/\[\[Note\]\]/g)?.length).toBe(1)
  })
})

describe('removeFromManagedBlock', () => {
  it('removes one stem from block with multiple', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[A]] [[B]]\n<!-- /superbrain:related -->'
    const result = removeFromManagedBlock(content, 'A')
    expect(result).not.toContain('[[A]]')
    expect(result).toContain('[[B]]')
  })

  it('removes entire block when last stem is removed', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Only]]\n<!-- /superbrain:related -->'
    const result = removeFromManagedBlock(content, 'Only')
    expect(result).not.toContain('superbrain:related')
    expect(result.trim()).toBe('body')
  })

  it('returns content unchanged when stem not in block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[A]]\n<!-- /superbrain:related -->'
    expect(removeFromManagedBlock(content, 'Missing')).toBe(content)
  })

  it('returns content unchanged when no block exists', () => {
    expect(removeFromManagedBlock('just some text', 'Note')).toBe('just some text')
  })
})

describe('parseNote - managedLinks', () => {
  it('returns empty array when no managed block', () => {
    const note = parseNote('notes/foo.md', 'just text')
    expect(note.managedLinks).toEqual([])
  })

  it('extracts managed links from body block', () => {
    const raw = `---
title: Test
---

Some body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const note = parseNote('notes/test.md', raw)
    expect(note.managedLinks).toEqual(['NoteA', 'NoteB'])
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd web && npx vitest run lib/__tests__/vault-parser.test.ts 2>&1 | tail -20
```

Expected: failures about `extractManagedBlock`, `addToManagedBlock`, `removeFromManagedBlock` not exported, and `managedLinks` missing.

- [ ] **Step 4: Implement block helpers and update `parseNote`**

In `web/lib/vault-parser.ts`, add these exports (use `matchAll` for wikilink extraction, no regex `.exec` loop needed):

```ts
export function extractManagedBlock(content: string): string[] {
  const match = content.match(/<!-- superbrain:related -->\n([\s\S]*?)\n<!-- \/superbrain:related -->/)
  if (!match) return []
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1])
}

export function addToManagedBlock(content: string, stem: string): string {
  const wikilink = `[[${stem}]]`
  const blockRe = /<!-- superbrain:related -->\n([\s\S]*?)\n<!-- \/superbrain:related -->/
  const match = content.match(blockRe)
  if (match) {
    if (match[1].includes(wikilink)) return content
    const updated = `${match[1]} ${wikilink}`.trim()
    return content.replace(blockRe, `<!-- superbrain:related -->\n${updated}\n<!-- /superbrain:related -->`)
  }
  const block = `\n<!-- superbrain:related -->\n${wikilink}\n<!-- /superbrain:related -->`
  return content.trimEnd() + block
}

export function removeFromManagedBlock(content: string, stem: string): string {
  const wikilink = `[[${stem}]]`
  const blockRe = /<!-- superbrain:related -->\n([\s\S]*?)\n<!-- \/superbrain:related -->/
  const match = content.match(blockRe)
  if (!match) return content
  const updated = match[1].replace(wikilink, '').replace(/\s+/g, ' ').trim()
  if (!updated) {
    return content.replace(/\n*<!-- superbrain:related -->\n[\s\S]*?\n<!-- \/superbrain:related -->/, '')
  }
  return content.replace(blockRe, `<!-- superbrain:related -->\n${updated}\n<!-- /superbrain:related -->`)
}
```

In `parseNote`, add `managedLinks` to the returned object:

```ts
return {
  path,
  stem,
  title: data.title ?? stemToTitle(stem),
  type: systemType(path) ?? (typeof data.type === 'string' && data.type.trim() ? data.type.trim() : 'note'),
  tags: data.tags ?? [],
  date: data.date instanceof Date
    ? data.date.toISOString().slice(0, 10)
    : typeof data.date === 'string'
      ? data.date
      : null,
  email,
  content,
  relations,
  wikilinks: [...wikilinksInBody],
  managedLinks: extractManagedBlock(content),
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd web && npx vitest run lib/__tests__/vault-parser.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd web && git add lib/types.ts lib/vault-parser.ts lib/__tests__/vault-parser.test.ts
git commit -m "feat: add managedLinks field and superbrain:related block helpers to parser"
```

---

### Task 2: API — extend PATCH with three new operations

**Files:**
- Modify: `web/app/api/vault/note/[...path]/route.ts`
- Create: `web/lib/__tests__/note-patch-helpers.test.ts`

The three pure helpers (`applySetType`, `applyAddRelation`, `applyRemoveRelation`) are exported from the route so they can be unit-tested without an HTTP server. This mirrors the existing pattern in `update-email/route.ts`.

- [ ] **Step 1: Write failing tests**

Create `web/lib/__tests__/note-patch-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
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
  it('adds typed relation to frontmatter and managed block', () => {
    const raw = '---\ntitle: Test\ntype: person\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', 'works_with')
    expect(result).toContain('Superbrain')
    expect(result).toContain('works_with')
    expect(result).toContain('<!-- superbrain:related -->')
    expect(result).toContain('[[Superbrain]]')
    expect(result).toContain('Body.')
  })

  it('adds untyped link only to managed block, not frontmatter relations', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', null)
    expect(result).not.toContain('relations:')
    expect(result).toContain('[[Superbrain]]')
    expect(result).toContain('<!-- superbrain:related -->')
  })

  it('does not duplicate typed relation if target already in relations', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyAddRelation(raw, 'Superbrain', 'part_of')
    expect(result.match(/target:/g)?.length).toBe(1)
  })
})

describe('applyRemoveRelation', () => {
  it('removes typed relation from frontmatter and body block', () => {
    const raw = `---
title: Test
relations:
  - target: '[[Superbrain]]'
    type: works_with
---

Body.
<!-- superbrain:related -->
[[Superbrain]]
<!-- /superbrain:related -->`
    const result = applyRemoveRelation(raw, 'Superbrain')
    expect(result).not.toContain('Superbrain')
    expect(result).not.toContain('relations:')
    expect(result).not.toContain('superbrain:related')
  })

  it('removes untyped managed link from body block only', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.\n<!-- superbrain:related -->\n[[NoteA]]\n<!-- /superbrain:related -->'
    const result = applyRemoveRelation(raw, 'NoteA')
    expect(result).not.toContain('NoteA')
    expect(result).not.toContain('superbrain:related')
    expect(result).toContain('Body.')
  })

  it('is a no-op when target not found anywhere', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyRemoveRelation(raw, 'Missing')
    expect(result).toContain('Body.')
    expect(result).not.toContain('Missing')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd web && npx vitest run lib/__tests__/note-patch-helpers.test.ts 2>&1 | tail -10
```

Expected: import error — functions not exported yet.

- [ ] **Step 3: Add imports and export helpers in `route.ts`**

Add to the imports at the top of `web/app/api/vault/note/[...path]/route.ts`:

```ts
import { addToManagedBlock, removeFromManagedBlock } from '@/lib/vault-parser'
```

Then add these exported functions before the route handlers:

```ts
export function applySetType(raw: string, type: string): string {
  const { data, content } = matter(raw)
  data.type = type
  return matter.stringify(content, data)
}

export function applyAddRelation(raw: string, target: string, relationType: string | null): string {
  const { data, content } = matter(raw)
  if (relationType) {
    const relations: any[] = data.relations ?? []
    const alreadyPresent = relations.some(
      (r: any) => (r.target as string).replace(/^\[\[|\]\]$/g, '') === target
    )
    if (!alreadyPresent) {
      relations.push({ target: `[[${target}]]`, type: relationType })
      data.relations = relations
    }
  }
  const updatedContent = addToManagedBlock(content, target)
  return matter.stringify(updatedContent, data)
}

export function applyRemoveRelation(raw: string, target: string): string {
  const { data, content } = matter(raw)
  if (Array.isArray(data.relations)) {
    data.relations = (data.relations as any[]).filter(
      (r: any) => (r.target as string).replace(/^\[\[|\]\]$/g, '') !== target
    )
    if (data.relations.length === 0) delete data.relations
  }
  const updatedContent = removeFromManagedBlock(content, target)
  return matter.stringify(updatedContent, data)
}
```

- [ ] **Step 4: Rewrite the `PATCH` handler to dispatch on `operation`**

Replace the existing `PATCH` handler in `web/app/api/vault/note/[...path]/route.ts`:

```ts
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path: pathSegments } = await params
  const filePath = pathSegments.join('/')
  const body = await req.json()

  const client = getVaultClient()
  const { content: raw, sha } = await client.readFile(filePath)
  const stem = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath

  let updated: string
  let message: string

  if (body.operation === 'set-type') {
    updated = applySetType(raw, body.type)
    message = `brain: set type of [[${stem}]] to ${body.type}`
  } else if (body.operation === 'add-relation') {
    updated = applyAddRelation(raw, body.target, body.relationType ?? null)
    message = `brain: link [[${stem}]] → [[${body.target}]]`
  } else if (body.operation === 'remove-relation') {
    updated = applyRemoveRelation(raw, body.target)
    message = `brain: unlink [[${stem}]] → [[${body.target}]]`
  } else if (typeof body.title === 'string') {
    const { data, content } = matter(raw)
    data.title = body.title
    updated = matter.stringify(content, data)
    message = `brain: rename [[${stem}]] to ${body.title}`
  } else {
    return NextResponse.json({ error: 'Unknown operation' }, { status: 400 })
  }

  await client.writeFile(filePath, updated, sha, message)
  invalidateCache()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd web && npx vitest run lib/__tests__/note-patch-helpers.test.ts 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd web && git add app/api/vault/note lib/__tests__/note-patch-helpers.test.ts
git commit -m "feat: extend note PATCH API with set-type, add-relation, remove-relation operations"
```

---

### Task 3: DetailPanel — type picker

**Files:**
- Modify: `web/components/DetailPanel.tsx`

The type badge in the header becomes a button that opens an inline grid of type pills. When a type is selected it immediately saves via PATCH and closes.

- [ ] **Step 1: Add new props to `Props` interface**

In `web/components/DetailPanel.tsx`, update the `Props` interface (around line 10):

```ts
interface Props {
  node: GraphNode | null
  note: VaultNote | null
  allEdges: GraphEdge[]
  allNodes: GraphNode[]
  onNoteUpdated: () => void
  onNoteDeleted: () => void
  onNavigate: (id: string) => void
  width: number
  collapsed: boolean
  onToggleCollapse: () => void
  onOpenSettings?: () => void
  noteTypes: { name: string; color: string }[]
  typeColors: Record<string, string>
}
```

- [ ] **Step 2: Update the function signature**

Change the destructure at line 45:

```ts
export function DetailPanel({ node, note, allEdges, allNodes, onNoteUpdated, onNoteDeleted, onNavigate, width, collapsed, onToggleCollapse, onOpenSettings, noteTypes, typeColors }: Props) {
```

- [ ] **Step 3: Add type picker state and rename the local `typeColors` to `typeStyle`**

Add new state variables after the existing ones (around line 55):

```ts
const [typePickerOpen, setTypePickerOpen] = useState(false)
const [settingType, setSettingType] = useState(false)
```

Find:
```ts
const typeColors = note ? (TYPE_COLORS[note.type] ?? TYPE_COLORS.note) : TYPE_COLORS.note
```

Replace with:
```ts
const typeStyle = note ? (TYPE_COLORS[note.type] ?? TYPE_COLORS.note) : TYPE_COLORS.note
```

Update all three references to `typeColors.bg`, `typeColors.text`, `typeColors.dot` in the JSX (around line 186–188) to `typeStyle.bg`, `typeStyle.text`, `typeStyle.dot`.

- [ ] **Step 4: Reset type picker in the note-change `useEffect`**

Update the existing `useEffect` that resets on `note?.path` change:

```ts
useEffect(() => {
  setEditing(false)
  setConfirmDelete(false)
  setRenaming(false)
  setTypePickerOpen(false)
}, [note?.path])
```

- [ ] **Step 5: Add `handleSetType` function**

Add after `handleDelete` (around line 100):

```ts
async function handleSetType(type: string) {
  if (!note || settingType) return
  setSettingType(true)
  try {
    await fetch(`/api/vault/note/${note.path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'set-type', type }),
    })
    onNoteUpdated()
  } finally {
    setSettingType(false)
    setTypePickerOpen(false)
  }
}
```

- [ ] **Step 6: Replace the static type badge with a clickable picker**

Find the static `<span>` type badge (around line 186):

```tsx
<span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${typeColors.bg} ${typeColors.text}`}>
  <span className={`w-1.5 h-1.5 rounded-full ${typeColors.dot}`} />
  {note.type}
</span>
```

Replace with:

```tsx
<div className="relative">
  <button
    onClick={() => setTypePickerOpen(v => !v)}
    disabled={settingType}
    className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer transition-opacity disabled:opacity-60"
    style={{ backgroundColor: `${typeColors[note.type] ?? '#94a3b8'}22`, color: typeColors[note.type] ?? '#94a3b8' }}
  >
    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: typeColors[note.type] ?? '#94a3b8' }} />
    {note.type}
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>
  {typePickerOpen && noteTypes.length > 0 && (
    <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg shadow-lg p-2 min-w-[180px]">
      <div className="grid grid-cols-2 gap-1">
        {noteTypes.map(t => (
          <button
            key={t.name}
            onClick={() => handleSetType(t.name)}
            disabled={settingType}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors text-left w-full ${
              t.name === note.type
                ? 'bg-slate-100 dark:bg-gray-800 font-medium text-gray-900 dark:text-white'
                : 'hover:bg-slate-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
            {t.name}
          </button>
        ))}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 7: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1
```

Expected: errors in `page.tsx` about missing `noteTypes` and `typeColors` props — these are fixed in Task 5.

- [ ] **Step 8: Commit**

```bash
cd web && git add components/DetailPanel.tsx
git commit -m "feat: add inline type picker to DetailPanel header"
```

---

### Task 4: DetailPanel — link management (remove + add)

**Files:**
- Modify: `web/components/DetailPanel.tsx`

This task rewrites the "Links to" section and adds the inline link picker for adding new links.

- [ ] **Step 1: Add link management state variables**

After the `settingType` state declaration, add:

```ts
const [removingLink, setRemovingLink] = useState<string | null>(null)
const [linkPickerOpen, setLinkPickerOpen] = useState(false)
const [pickerType, setPickerType] = useState('')
const [pickerTarget, setPickerTarget] = useState('')
const [pickerRelationType, setPickerRelationType] = useState('')
const [addingLink, setAddingLink] = useState(false)
```

- [ ] **Step 2: Reset link state in the note-change `useEffect`**

```ts
useEffect(() => {
  setEditing(false)
  setConfirmDelete(false)
  setRenaming(false)
  setTypePickerOpen(false)
  setLinkPickerOpen(false)
  setPickerType('')
  setPickerTarget('')
  setPickerRelationType('')
}, [note?.path])
```

- [ ] **Step 3: Add `handleRemoveRelation` and `handleAddRelation` functions**

Add after `handleSetType`:

```ts
async function handleRemoveRelation(target: string) {
  if (!note || removingLink) return
  setRemovingLink(target)
  try {
    await fetch(`/api/vault/note/${note.path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'remove-relation', target }),
    })
    onNoteUpdated()
  } finally {
    setRemovingLink(null)
  }
}

async function handleAddRelation() {
  if (!note || !pickerTarget || addingLink) return
  setAddingLink(true)
  try {
    await fetch(`/api/vault/note/${note.path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'add-relation',
        target: pickerTarget,
        relationType: pickerRelationType || null,
      }),
    })
    onNoteUpdated()
    setLinkPickerOpen(false)
    setPickerTarget('')
    setPickerRelationType('')
  } finally {
    setAddingLink(false)
  }
}
```

- [ ] **Step 4: Compute derived link sets before the return statement**

Add after `const nodeById = Object.fromEntries(allNodes.map(n => [n.id, n]))`:

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

- [ ] **Step 5: Replace the "Links to / Linked from" section in JSX**

Find and replace the entire outgoing/incoming block (currently `{(outgoing.length > 0 || incoming.length > 0) && (` — around line 290):

```tsx
{(note.relations.length > 0 || untypedManaged.length > 0 || organicLinks.length > 0 || incoming.length > 0) && (
  <div className="border-t border-slate-100 dark:border-gray-800/60 px-5 py-4 space-y-4">
    {(note.relations.length > 0 || untypedManaged.length > 0 || organicLinks.length > 0) && (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">Links to</h3>
          <button
            onClick={() => {
              setLinkPickerOpen(v => !v)
              if (pickerTypes.length > 0 && !pickerType) setPickerType(pickerTypes[0])
            }}
            className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
          >
            + Toevoegen
          </button>
        </div>
        <ul className="space-y-0.5">
          {note.relations.map(rel => {
            const targetId = rel.target.toLowerCase()
            const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
            return (
              <li key={`rel-${rel.target}`} className="flex items-center gap-2 py-0.5 group">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
                  {nodeById[targetId]?.title ?? rel.target}
                </button>
                <span className="text-xs text-orange-500/70 shrink-0">{rel.type}</span>
                <button
                  onClick={() => handleRemoveRelation(rel.target)}
                  disabled={removingLink === rel.target}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 disabled:opacity-30"
                  title="Remove link"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </li>
            )
          })}
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
                  disabled={removingLink === stem}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 disabled:opacity-30"
                  title="Remove link"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </li>
            )
          })}
          {organicLinks.map(stem => {
            const targetId = stem.toLowerCase()
            const dot = TYPE_DOT[nodeById[targetId]?.type ?? ''] ?? 'bg-slate-400'
            return (
              <li key={`organic-${stem}`} className="flex items-center gap-2 py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <button onClick={() => onNavigate(targetId)} className="text-xs text-slate-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 transition-colors truncate flex-1 text-left cursor-pointer">
                  {nodeById[targetId]?.title ?? stem}
                </button>
                <span className="text-xs text-slate-300 dark:text-gray-600 shrink-0" title="In-text link">↩</span>
              </li>
            )
          })}
        </ul>

        {linkPickerOpen && (
          <div className="mt-3 border border-slate-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="flex overflow-x-auto border-b border-slate-100 dark:border-gray-800">
              {pickerTypes.map(t => (
                <button
                  key={t}
                  onClick={() => { setPickerType(t); setPickerTarget('') }}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap cursor-pointer transition-colors ${
                    pickerType === t
                      ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-500'
                      : 'text-slate-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="max-h-36 overflow-y-auto">
              {pickerNotes.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-gray-600 px-3 py-2 italic">No notes of this type</p>
              ) : (
                pickerNotes.map(n => (
                  <button
                    key={n.id}
                    onClick={() => setPickerTarget(pickerTarget === n.title ? '' : n.title)}
                    className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                      pickerTarget === n.title
                        ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {n.title}
                  </button>
                ))
              )}
            </div>
            <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800 flex items-center gap-2">
              <select
                value={pickerRelationType}
                onChange={e => setPickerRelationType(e.target.value)}
                className="flex-1 text-xs bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded px-1.5 py-1 text-slate-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="">— geen relatietype —</option>
                <option value="works_with">works_with</option>
                <option value="part_of">part_of</option>
                <option value="inspired_by">inspired_by</option>
                <option value="references">references</option>
              </select>
              <button
                onClick={handleAddRelation}
                disabled={!pickerTarget || addingLink}
                className="px-2.5 py-1 text-xs bg-teal-600 text-white rounded font-medium hover:bg-teal-500 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {addingLink ? '…' : 'Toevoegen'}
              </button>
              <button
                onClick={() => setLinkPickerOpen(false)}
                className="text-xs text-slate-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    )}

    {incoming.length > 0 && (
      <div>
        <h3 className="text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-2">Linked from</h3>
        <ul className="space-y-0.5">
          {incoming.map(e => {
            const dot = TYPE_DOT[nodeById[e.source]?.type] ?? 'bg-slate-400'
            return (
              <li key={`${e.source}-${e.target}`}>
                <button onClick={() => onNavigate(e.source)} className="group flex items-center gap-2 w-full text-left py-1 cursor-pointer">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                  <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors truncate">
                    {nodeById[e.source]?.title ?? e.source}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1
```

Expected: only errors about missing props in `page.tsx` (fixed next task).

- [ ] **Step 7: Commit**

```bash
cd web && git add components/DetailPanel.tsx
git commit -m "feat: add link add/remove UI to DetailPanel with inline note picker"
```

---

### Task 5: Wire up new props in `page.tsx`

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Pass `noteTypes` and `typeColors` to `DetailPanel`**

Find the `<DetailPanel` block in `web/app/page.tsx` (around line 575) and add the two new props:

```tsx
<DetailPanel
  node={selectedNode}
  note={selectedNote}
  allEdges={graph.edges}
  allNodes={graph.nodes}
  onNoteUpdated={handleNoteUpdated}
  onNoteDeleted={() => { setSelectedId(null); loadGraph() }}
  onNavigate={setSelectedId}
  width={panelWidth}
  collapsed={panelCollapsed}
  onToggleCollapse={togglePanel}
  onOpenSettings={() => setShowSettings(true)}
  noteTypes={noteTypes}
  typeColors={typeColors}
/>
```

- [ ] **Step 2: TypeScript check**

```bash
cd web && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
cd web && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd web && git add app/page.tsx
git commit -m "feat: wire noteTypes and typeColors props into DetailPanel"
```
