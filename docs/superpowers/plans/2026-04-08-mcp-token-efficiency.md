# MCP Token Efficiency & Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three MCP server improvements — default content truncation in `read_note`, a new `get_context` tool for smart search, and a new `get_index` tool for vault-wide structural maps.

**Architecture:** All changes are in `mcp/src/`. Tests use vitest. Modules are ESM with `.js` extensions in imports. Each tool is a standalone file in `mcp/src/tools/` registered in `mcp/src/index.ts`.

**Tech Stack:** TypeScript, vitest, `@modelcontextprotocol/sdk`

**Spec:** `docs/superpowers/specs/2026-04-08-mcp-token-efficiency-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `mcp/src/tools/read-note.ts` | Modify | Add `full` param and truncation logic |
| `mcp/src/tools/get-context.ts` | Create | New `get_context` tool |
| `mcp/src/tools/get-index.ts` | Create | New `get_index` tool |
| `mcp/src/index.ts` | Modify | Register two new tools |
| `mcp/src/__tests__/read-note.test.ts` | Create | Tests for read_note truncation |
| `mcp/src/__tests__/get-context.test.ts` | Create | Tests for get_context tool |
| `mcp/src/__tests__/get-index.test.ts` | Create | Tests for get_index tool |

---

### Task 1: `read_note` — default content truncation

**Files:**
- Modify: `mcp/src/tools/read-note.ts`
- Create: `mcp/src/__tests__/read-note.test.ts`

- [ ] **Step 1: Write failing tests for truncation**

Create `mcp/src/__tests__/read-note.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createReadTool } from '../tools/read-note.js'

// Build a minimal VaultReader stub with controlled notes
function makeVault(notes: { path: string; content: string }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    path: n.path,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    title: n.path.split('/').pop()!.replace(/\.md$/, ''),
    type: 'note',
    tags: [],
    content: n.content,
    wikilinks: [],
  }))
  vault.getNoteByPath = (p: string) => parsed.find(n => n.path === p)
  vault.getNoteByTitle = (t: string) => parsed.find(n => n.title.toLowerCase() === t.toLowerCase())
  return vault
}

describe('read_note truncation', () => {
  const longContent = 'Line one\n'.repeat(300) // ~2700 chars
  const shortContent = 'Short note content.'
  let tool: ReturnType<typeof createReadTool>

  beforeEach(() => {
    tool = createReadTool(makeVault([
      { path: 'notes/long.md', content: longContent },
      { path: 'notes/short.md', content: shortContent },
    ]))
  })

  it('truncates content at nearest newline before 2000 chars by default', async () => {
    const result = await tool.execute({ path: 'notes/long.md' })
    expect(result.content.length).toBeLessThanOrEqual(2000)
    expect(result.content.endsWith('\n')).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('returns full content when full=true', async () => {
    const result = await tool.execute({ path: 'notes/long.md', full: true })
    expect(result.content).toBe(longContent)
    expect(result.truncated).toBeUndefined()
  })

  it('does not truncate short content', async () => {
    const result = await tool.execute({ path: 'notes/short.md' })
    expect(result.content).toBe(shortContent)
    expect(result.truncated).toBeUndefined()
  })

  it('hard-cuts at 2000 when no newline exists before limit', async () => {
    const noNewlines = 'a'.repeat(3000)
    const vault = makeVault([{ path: 'notes/no-nl.md', content: noNewlines }])
    const t = createReadTool(vault)
    const result = await t.execute({ path: 'notes/no-nl.md' })
    expect(result.content.length).toBe(2000)
    expect(result.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd mcp && npx vitest run src/__tests__/read-note.test.ts`
Expected: FAIL — `truncated` property does not exist, content is not truncated.

- [ ] **Step 3: Implement truncation in read-note.ts**

Replace the full content of `mcp/src/tools/read-note.ts`:

```typescript
import { VaultReader } from '../vault-reader.js'

const MAX_CHARS = 2000

function truncateContent(content: string): { content: string; truncated?: true } {
  if (content.length <= MAX_CHARS) return { content }
  const lastNewline = content.lastIndexOf('\n', MAX_CHARS)
  const cutAt = lastNewline > 0 ? lastNewline + 1 : MAX_CHARS
  return { content: content.slice(0, cutAt), truncated: true }
}

export function createReadTool(vault: VaultReader) {
  return {
    name: 'read_note',
    description: 'Read a note by its relative path or title. Returns truncated content by default (2000 chars). Pass full=true for complete content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path, e.g. people/Milan.md' },
        title: { type: 'string', description: 'Note title or stem (case-insensitive)' },
        full: { type: 'boolean', description: 'Return full content without truncation (default: false)' },
      },
    },
    async execute({ path, title, full }: { path?: string; title?: string; full?: boolean }) {
      const note = path
        ? vault.getNoteByPath(path)
        : vault.getNoteByTitle(title ?? '')
      if (!note) return { error: 'Note not found' }

      const { content, truncated } = full
        ? { content: note.content, truncated: undefined }
        : truncateContent(note.content)

      return {
        path: note.path,
        title: note.title,
        type: note.type,
        tags: note.tags,
        content,
        ...(truncated ? { truncated } : {}),
      }
    },
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd mcp && npx vitest run src/__tests__/read-note.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `cd mcp && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/read-note.ts mcp/src/__tests__/read-note.test.ts
git commit -m "feat(mcp): add default content truncation to read_note"
```

---

### Task 2: New tool `get_context`

**Files:**
- Create: `mcp/src/tools/get-context.ts`
- Create: `mcp/src/__tests__/get-context.test.ts`
- Modify: `mcp/src/index.ts` (register tool)

- [ ] **Step 1: Write failing tests for get_context**

Create `mcp/src/__tests__/get-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createGetContextTool } from '../tools/get-context.js'

function makeVault(notes: { path: string; title: string; content: string; wikilinks?: string[] }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    path: n.path,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    title: n.title,
    type: 'note',
    tags: ['test'],
    content: n.content,
    wikilinks: n.wikilinks ?? [],
  }))
  vault.getAllNotes = () => parsed
  return vault
}

describe('get_context', () => {
  const notes = [
    {
      path: 'projects/superbrain.md',
      title: 'Superbrain',
      content: 'A knowledge graph that runs locally. It reads the Obsidian vault and exposes it via MCP.',
      wikilinks: ['Milan van Bruggen', 'Obsidian'],
    },
    {
      path: 'people/milan.md',
      title: 'Milan van Bruggen',
      content: 'AI Catalyst helping teams adopt AI through practical tools.',
      wikilinks: ['Superbrain'],
    },
  ]

  it('returns matching notes with excerpts', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].path).toBe('projects/superbrain.md')
    expect(result.results[0].excerpt).toContain('knowledge graph')
    expect(result.results[0].links).toEqual(['Milan van Bruggen', 'Obsidian'])
  })

  it('is case-insensitive', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'KNOWLEDGE GRAPH' })
    expect(result.results).toHaveLength(1)
  })

  it('returns excerpt from content start when match is title-only', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'Milan van Bruggen' })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].excerpt).toContain('AI Catalyst')
  })

  it('truncates title-only excerpt at 200 chars with trailing ...', async () => {
    const longContent = 'word '.repeat(100) // 500 chars
    const tool = createGetContextTool(makeVault([
      { path: 'notes/long-title.md', title: 'Unique Title Match', content: longContent },
    ]))
    const result = await tool.execute({ query: 'Unique Title Match' })
    expect(result.results[0].excerpt.length).toBeLessThanOrEqual(203) // 200 + '...'
    expect(result.results[0].excerpt.endsWith('...')).toBe(true)
  })

  it('returns empty excerpt when content is empty', async () => {
    const tool = createGetContextTool(makeVault([
      { path: 'notes/empty.md', title: 'Empty Note', content: '' },
    ]))
    const result = await tool.execute({ query: 'Empty Note' })
    expect(result.results[0].excerpt).toBe('')
  })

  it('respects limit parameter', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'a', limit: 1 })
    expect(result.results).toHaveLength(1)
  })

  it('clamps limit to 10', async () => {
    const manyNotes = Array.from({ length: 15 }, (_, i) => ({
      path: `notes/note-${i}.md`,
      title: `Note ${i}`,
      content: `Content about topic ${i}`,
    }))
    const tool = createGetContextTool(makeVault(manyNotes))
    const result = await tool.execute({ query: 'topic', limit: 50 })
    expect(result.results.length).toBeLessThanOrEqual(10)
  })

  it('adds ... prefix/suffix only when excerpt is cut', async () => {
    const longContent = 'x'.repeat(150) + ' knowledge graph ' + 'y'.repeat(150)
    const tool = createGetContextTool(makeVault([
      { path: 'notes/long.md', title: 'Long', content: longContent },
    ]))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results[0].excerpt.startsWith('...')).toBe(true)
    expect(result.results[0].excerpt.endsWith('...')).toBe(true)
  })

  it('no ... prefix when match is near content start', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results[0].excerpt.startsWith('...')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd mcp && npx vitest run src/__tests__/get-context.test.ts`
Expected: FAIL — module `../tools/get-context.js` not found.

- [ ] **Step 3: Implement get-context.ts**

Create `mcp/src/tools/get-context.ts`:

```typescript
import { VaultReader } from '../vault-reader.js'

const MAX_EXCERPT = 200
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

function buildExcerpt(content: string, query: string): string {
  if (!content) return ''

  const lower = content.toLowerCase()
  const pos = lower.indexOf(query.toLowerCase())

  // Title-only match: return start of content
  if (pos === -1) {
    if (content.length <= MAX_EXCERPT) return content
    return content.slice(0, MAX_EXCERPT) + '...'
  }

  // Centre the excerpt window on the match, capped at MAX_EXCERPT chars
  const matchLen = query.length
  const pad = Math.max(0, Math.floor((MAX_EXCERPT - matchLen) / 2))
  const start = Math.max(0, pos - pad)
  const end = Math.min(content.length, start + MAX_EXCERPT)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''
  return prefix + content.slice(start, end) + suffix
}

export function createGetContextTool(vault: VaultReader) {
  return {
    name: 'get_context',
    description: 'Search notes and return matching results with excerpts and outgoing links in one call. More efficient than search_notes + multiple read_note calls.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (case-insensitive)' },
        limit: { type: 'number', description: 'Max results (default: 5, max: 10)' },
      },
      required: ['query'],
    },
    async execute({ query, limit }: { query: string; limit?: number }) {
      const cap = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const lower = query.toLowerCase()
      const results = vault
        .getAllNotes()
        .filter(
          n =>
            n.title.toLowerCase().includes(lower) ||
            n.content.toLowerCase().includes(lower)
        )
        .slice(0, cap)
        .map(n => ({
          path: n.path,
          title: n.title,
          type: n.type,
          tags: n.tags,
          excerpt: buildExcerpt(n.content, query),
          links: n.wikilinks,
        }))
      return { results }
    },
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd mcp && npx vitest run src/__tests__/get-context.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/get-context.ts mcp/src/__tests__/get-context.test.ts
git commit -m "feat(mcp): add get_context tool for smart search with excerpts"
```

---

### Task 3: New tool `get_index`

**Files:**
- Create: `mcp/src/tools/get-index.ts`
- Create: `mcp/src/__tests__/get-index.test.ts`
- Modify: `mcp/src/index.ts` (register tool)

- [ ] **Step 1: Write failing tests for get_index**

Create `mcp/src/__tests__/get-index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createGetIndexTool } from '../tools/get-index.js'

function makeVault(notes: { path: string; title: string; type: string; tags: string[]; wikilinks: string[] }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    ...n,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    content: '',
  }))
  vault.getAllNotes = () => parsed
  return vault
}

describe('get_index', () => {
  const notes = [
    { path: 'people/milan.md', title: 'Milan', type: 'person', tags: ['founder'], wikilinks: ['Superbrain', 'Obsidian'] },
    { path: 'projects/superbrain.md', title: 'Superbrain', type: 'project', tags: ['ai'], wikilinks: ['Milan'] },
    { path: 'notes/empty.md', title: 'Empty', type: 'note', tags: [], wikilinks: [] },
  ]

  it('returns all notes with structural metadata', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    expect(result.notes).toHaveLength(3)
  })

  it('includes link_count matching links array length', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    const milan = result.notes.find((n: any) => n.path === 'people/milan.md')
    expect(milan.link_count).toBe(2)
    expect(milan.links).toEqual(['Superbrain', 'Obsidian'])
  })

  it('does not include content field', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    result.notes.forEach((n: any) => {
      expect(n).not.toHaveProperty('content')
    })
  })

  it('handles notes with zero links', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    const empty = result.notes.find((n: any) => n.path === 'notes/empty.md')
    expect(empty.link_count).toBe(0)
    expect(empty.links).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd mcp && npx vitest run src/__tests__/get-index.test.ts`
Expected: FAIL — module `../tools/get-index.js` not found.

- [ ] **Step 3: Implement get-index.ts**

Create `mcp/src/tools/get-index.ts`:

```typescript
import { VaultReader } from '../vault-reader.js'

export function createGetIndexTool(vault: VaultReader) {
  return {
    name: 'get_index',
    description: 'Get a compact structural map of the entire vault — all notes with their types, tags, and outgoing links. No content is returned. Use this to orient yourself before reading specific notes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    async execute() {
      return {
        notes: vault.getAllNotes().map(n => ({
          path: n.path,
          title: n.title,
          type: n.type,
          tags: n.tags,
          link_count: n.wikilinks.length,
          links: n.wikilinks,
        })),
      }
    },
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd mcp && npx vitest run src/__tests__/get-index.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/get-index.ts mcp/src/__tests__/get-index.test.ts
git commit -m "feat(mcp): add get_index tool for vault-wide structural map"
```

---

### Task 4: Register new tools in index.ts

**Files:**
- Modify: `mcp/src/index.ts`

- [ ] **Step 1: Add imports and register tools**

In `mcp/src/index.ts`, add two imports after the existing ones (after line 6):

```typescript
import { createGetContextTool } from './tools/get-context.js'
import { createGetIndexTool } from './tools/get-index.js'
```

Add the new tools to the `tools` array (after line 21):

```typescript
const tools = [
  createSearchTool(vault),
  createReadTool(vault),
  createWriteTool(vault),
  createGetRelatedTool(vault),
  createListTool(vault),
  createGetContextTool(vault),
  createGetIndexTool(vault),
]
```

- [ ] **Step 2: Build and verify**

Run: `cd mcp && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Run all tests**

Run: `cd mcp && npx vitest run`
Expected: all tests PASS (existing + 17 new tests).

- [ ] **Step 4: Commit**

```bash
git add mcp/src/index.ts
git commit -m "feat(mcp): register get_context and get_index tools"
```
