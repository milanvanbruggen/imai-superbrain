# Vault as Second Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code's memory visible in Obsidian and give Claude Cowork access to personal context from the vault via a new `get_context` MCP tool.

**Architecture:** Two independent components: (1) a bash sync script that bidirectionally rsyncs between `~/.claude/projects/.../memory/` and `Claude/memory/` in the vault, triggered by a PostToolUse hook; (2) a `get_context(topic?)` MCP tool added to the existing `/api/mcp` route that reads `Claude/` files directly without loading the full vault.

**Tech Stack:** bash/rsync, TypeScript/Vitest, Next.js App Router, `@modelcontextprotocol/sdk`, zod

**Spec:** `docs/superpowers/specs/2026-04-06-vault-second-brain-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `web/app/api/mcp/route.ts` | Modify | Extract `searchNoteMap` helper (exported for testability), add `getContextText`, register `get_context` tool |
| `web/lib/__tests__/mcp-context.test.ts` | Create | Tests for `searchNoteMap` and `getContextText` |
| `scripts/sync-brain.sh` | Create | Bidirectional rsync between local memory and vault |
| `~/.claude/settings.json` | Modify | PostToolUse hook that calls sync-brain.sh local-to-vault |
| `CLAUDE.md` (repo root) | Modify | Session-start vault-to-local sync instruction |

---

## Task 1: Extract `searchNoteMap` helper

**Files:**
- Modify: `web/app/api/mcp/route.ts` (lines 84–102)

The inline search logic in `search_notes` needs to become a named function so `get_context` can reuse it. It is exported so tests can import it directly without going through the full MCP request cycle.

- [ ] **Step 1: Write the failing test**

Create `web/lib/__tests__/mcp-context.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/vault-client', () => ({
  getVaultClient: vi.fn(),
}))
vi.mock('@/lib/vault-parser', () => ({
  buildGraph: () => ({ nodes: [], edges: [], notesByStem: {} }),
}))

// Reset module cache after every test so vi.doMock overrides in getContextText tests
// don't leak into subsequent imports.
afterEach(() => {
  vi.resetModules()
})

describe('searchNoteMap', () => {
  it('returns notes matching query in title', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map([
      ['a/note.md', { path: 'a/note.md', title: 'My Project Notes', type: 'note', tags: [], content: 'some content' }],
      ['b/other.md', { path: 'b/other.md', title: 'Something Else', type: 'note', tags: [], content: 'unrelated' }],
    ])
    const results = searchNoteMap(noteMap, 'project')
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('a/note.md')
  })

  it('returns notes matching query in content', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map([
      ['a/note.md', { path: 'a/note.md', title: 'General', type: 'note', tags: [], content: 'details about TypeScript' }],
    ])
    const results = searchNoteMap(noteMap, 'typescript')
    expect(results).toHaveLength(1)
  })

  it('returns at most 10 results', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map(
      Array.from({ length: 15 }, (_, i) => [
        `note-${i}.md`,
        { path: `note-${i}.md`, title: `Match ${i}`, type: 'note', tags: [], content: 'matching content' },
      ])
    )
    const results = searchNoteMap(noteMap, 'match')
    expect(results).toHaveLength(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/mcp-context.test.ts
```

Expected: FAIL — `searchNoteMap is not a function` (not exported yet)

- [ ] **Step 3: Extract `searchNoteMap` from route.ts**

In `web/app/api/mcp/route.ts`, add this function before `createMcpServer()`:

```typescript
export function searchNoteMap(
  noteMap: Map<string, { path: string; title: string; type: string; tags: string[]; content: string }>,
  query: string
): { path: string; title: string; type: string }[] {
  const lower = query.toLowerCase()
  return Array.from(noteMap.values())
    .filter(n => n.title.toLowerCase().includes(lower) || n.content.toLowerCase().includes(lower))
    .slice(0, 10)
    .map(n => ({ path: n.path, title: n.title, type: n.type }))
}
```

Then update the `search_notes` tool callback to call this helper (replace the inline filter/slice/map at lines 93–97):

```typescript
async ({ query }) => {
  const { noteMap } = await loadNotes()
  const results = searchNoteMap(noteMap, query)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ results }, null, 2) }],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/mcp-context.test.ts --reporter=verbose
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add web/app/api/mcp/route.ts web/lib/__tests__/mcp-context.test.ts
git commit -m "refactor: extract searchNoteMap helper from search_notes tool"
```

---

## Task 2: Add `getContextText` and `get_context` MCP tool

**Files:**
- Modify: `web/app/api/mcp/route.ts`
- Modify: `web/lib/__tests__/mcp-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/__tests__/mcp-context.test.ts`:

```typescript
describe('getContextText', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns placeholder when vault client throws', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => { throw new Error('not configured') },
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText()
    expect(result).toBe('(No personal context configured. Create Claude/profile.md in your vault to get started.)')
    vi.doUnmock('@/lib/vault-client')
  })

  it('returns structured sections for existing and missing files', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => ({
        readFile: async (path: string) => {
          if (path === 'Claude/profile.md') return { content: 'I am Milan', sha: null }
          throw new Error('not found')
        },
        getMarkdownTree: async () => [],
      }),
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText()
    expect(result).toContain('## Profile\nI am Milan')
    expect(result).toContain('## Active Projects\n(not set up yet)')  // intentional user input → not set up yet
    expect(result).toContain('## Memory: User\n(empty)')              // auto-generated memory file → empty
    vi.doUnmock('@/lib/vault-client')
  })

  it('appends related notes section when topic is given', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => ({
        readFile: async () => ({ content: '', sha: null }),
        getMarkdownTree: async () => [{ path: 'projects/foo.md' }],
      }),
    }))
    vi.doMock('@/lib/vault-parser', () => ({
      buildGraph: () => ({
        nodes: [{ path: 'projects/foo.md', title: 'Foo Project', type: 'note', tags: [] }],
        edges: [],
        notesByStem: {},
      }),
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText('foo')
    expect(result).toContain('## Related Notes (topic: "foo")')
    expect(result).toContain('projects/foo.md — Foo Project')
    vi.doUnmock('@/lib/vault-client')
    vi.doUnmock('@/lib/vault-parser')
  })
})
```

Note: `beforeEach(() => vi.resetModules())` ensures each test starts with a fresh module cache so `vi.doMock` takes effect on the `await import(...)` calls inside each test. The top-level `afterEach(() => vi.resetModules())` added in Task 1 already handles cleanup between tests, but having an explicit `beforeEach` in this describe block makes the intent clear.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/mcp-context.test.ts
```

Expected: FAIL — `getContextText is not a function`

- [ ] **Step 3: Add `getContextText` to route.ts**

Add after `searchNoteMap` and before `createMcpServer()`:

```typescript
export async function getContextText(topic?: string): Promise<string> {
  // fallback: what to show when the file is missing
  // profile/active-projects are intentional user inputs → "(not set up yet)"
  // memory files are auto-generated by Claude Code → "(empty)" when absent
  const claudeFiles = [
    { path: 'Claude/profile.md', header: 'Profile', fallback: '(not set up yet)' },
    { path: 'Claude/active-projects.md', header: 'Active Projects', fallback: '(not set up yet)' },
    { path: 'Claude/memory/user.md', header: 'Memory: User', fallback: '(empty)' },
    { path: 'Claude/memory/feedback.md', header: 'Memory: Feedback', fallback: '(empty)' },
    { path: 'Claude/memory/project.md', header: 'Memory: Projects', fallback: '(empty)' },
    { path: 'Claude/memory/reference.md', header: 'Memory: References', fallback: '(empty)' },
  ]
  let client
  try {
    client = getVaultClient()
  } catch {
    return '(No personal context configured. Create Claude/profile.md in your vault to get started.)'
  }
  const sections: string[] = []
  for (const { path, header, fallback } of claudeFiles) {
    try {
      const { content } = await client.readFile(path)
      sections.push(`## ${header}\n${content.trim() || fallback}`)
    } catch {
      sections.push(`## ${header}\n${fallback}`)
    }
  }
  if (topic) {
    try {
      const { noteMap } = await loadNotes()
      const results = searchNoteMap(noteMap, topic)
      if (results.length > 0) {
        const lines = results.map(n => `- ${n.path} — ${n.title}`)
        sections.push(`## Related Notes (topic: "${topic}")\n${lines.join('\n')}`)
      }
    } catch { /* search failure is non-fatal */ }
  }
  return sections.join('\n\n')
}
```

- [ ] **Step 4: Register the `get_context` tool in `createMcpServer()`**

In `createMcpServer()`, add after the `get_related` tool registration (before `return server`):

```typescript
// get_context
server.tool(
  'get_context',
  'Load personal context from the vault (profile, active projects, memory). Optionally search for notes related to a topic.',
  {
    topic: z.string().optional().describe('Optional topic to search for related notes'),
  },
  async ({ topic }) => {
    const text = await getContextText(topic)
    return {
      content: [{ type: 'text' as const, text }],
    }
  }
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run lib/__tests__/mcp-context.test.ts --reporter=verbose
```

Expected: PASS (6 tests)

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain/web && npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add web/app/api/mcp/route.ts web/lib/__tests__/mcp-context.test.ts
git commit -m "feat: add getContextText and get_context MCP tool"
```

---

## Task 3: Create `scripts/sync-brain.sh`

**Files:**
- Create: `scripts/sync-brain.sh`

The script derives all paths dynamically so it works on any machine.

- [ ] **Step 1: Create `scripts/sync-brain.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

DIRECTION="${1:-}"
WRITTEN_FILE="${2:-}"

# Load VAULT_PATH from web/.env.local if not already set
if [[ -z "${VAULT_PATH:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../web/.env.local"
  if [[ -f "$ENV_FILE" ]]; then
    VAULT_PATH="$(grep '^VAULT_PATH=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'")"
    export VAULT_PATH
  fi
fi

if [[ -z "${VAULT_PATH:-}" ]]; then
  echo "Error: VAULT_PATH is not set and could not be loaded from web/.env.local" >&2
  exit 1
fi

# Derive LOCAL_MEMORY path from git root (Claude Code convention: replace / with -)
REPO_ROOT=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
PROJECT_SLUG=$(echo "$REPO_ROOT" | sed 's|^/||; s|/|-|g')
LOCAL_MEMORY="$HOME/.claude/projects/$PROJECT_SLUG/memory"
VAULT_MEMORY="${VAULT_PATH}/Claude/memory"

if [[ "$DIRECTION" == "local-to-vault" ]]; then
  # Guard: only sync when the written file is inside LOCAL_MEMORY
  if [[ -n "$WRITTEN_FILE" && "$WRITTEN_FILE" != "$LOCAL_MEMORY"* ]]; then
    exit 0
  fi
  if [[ ! -d "$LOCAL_MEMORY" ]]; then
    exit 0  # nothing to sync yet
  fi
  mkdir -p "$VAULT_MEMORY"
  rsync -av --update "$LOCAL_MEMORY/" "$VAULT_MEMORY/"

elif [[ "$DIRECTION" == "vault-to-local" ]]; then
  if [[ ! -d "$VAULT_MEMORY" ]]; then
    echo "No vault memory directory found at $VAULT_MEMORY — skipping"
    exit 0
  fi
  mkdir -p "$LOCAL_MEMORY"
  rsync -av --update "$VAULT_MEMORY/" "$LOCAL_MEMORY/"

else
  echo "Usage: sync-brain.sh <local-to-vault|vault-to-local> [written-file-path]" >&2
  exit 1
fi
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x /Users/milanvanbruggen/Web/mai-superbrain/scripts/sync-brain.sh
```

- [ ] **Step 3: Smoke test the script**

Run from the repo root:

```bash
cd /Users/milanvanbruggen/Web/mai-superbrain && VAULT_PATH="/tmp/test-vault" bash scripts/sync-brain.sh vault-to-local
```

Expected output: `No vault memory directory found at /tmp/test-vault/Claude/memory — skipping`

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-brain.sh
git commit -m "feat: add sync-brain.sh for bidirectional vault memory sync"
```

---

## Task 4: Configure Claude Code hook and CLAUDE.md

**Files:**
- Modify: `~/.claude/settings.json`
- Modify or create: `/Users/milanvanbruggen/Web/mai-superbrain/CLAUDE.md`

- [ ] **Step 1: Check if root CLAUDE.md exists**

```bash
ls /Users/milanvanbruggen/Web/mai-superbrain/CLAUDE.md 2>/dev/null || echo "not found"
```

- [ ] **Step 2: Add memory sync instruction to root CLAUDE.md**

If `CLAUDE.md` exists, append. If not, create it. The exact content to add:

```markdown
## Memory sync
At the start of each session, run: `bash scripts/sync-brain.sh vault-to-local`
This pulls any changes made in Obsidian into local memory.
```

- [ ] **Step 3: Read existing `~/.claude/settings.json`**

```bash
cat ~/.claude/settings.json
```

Note the current structure before editing.

- [ ] **Step 4: Add the PostToolUse hook**

Merge the following into the `hooks` section of `~/.claude/settings.json`:

```json
"hooks": {
  "PostToolUse": [{
    "matcher": "Write",
    "hooks": [{
      "type": "command",
      "command": "bash /Users/milanvanbruggen/Web/mai-superbrain/scripts/sync-brain.sh local-to-vault \"${TOOL_INPUT_PATH}\""
    }]
  }]
}
```

If `hooks` already exists with other entries, add this entry to the existing `PostToolUse` array (or create the array if `PostToolUse` doesn't exist yet).

- [ ] **Step 5: Verify hook syntax is valid JSON**

```bash
cat ~/.claude/settings.json | python3 -m json.tool > /dev/null && echo "Valid JSON"
```

Expected: `Valid JSON`

- [ ] **Step 6: Test the sync script end-to-end**

Write a test file directly to the local memory directory and verify it syncs to the vault:

```bash
echo "test" > ~/.claude/projects/Users-milanvanbruggen-Web-mai-superbrain/memory/test-sync.md
bash /Users/milanvanbruggen/Web/mai-superbrain/scripts/sync-brain.sh local-to-vault ~/.claude/projects/Users-milanvanbruggen-Web-mai-superbrain/memory/test-sync.md
```

Then source `VAULT_PATH` and verify:

```bash
VAULT_PATH=$(grep '^VAULT_PATH=' /Users/milanvanbruggen/Web/mai-superbrain/web/.env.local | cut -d'=' -f2- | tr -d '"' | tr -d "'")
ls "$VAULT_PATH/Claude/memory/test-sync.md" && echo "Sync OK"
```

Clean up:

```bash
rm ~/.claude/projects/Users-milanvanbruggen-Web-mai-superbrain/memory/test-sync.md
rm "$VAULT_PATH/Claude/memory/test-sync.md"
```

- [ ] **Step 7: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "feat: add vault-to-local session-start sync instruction"
```

---

## Vault Bootstrap Reminder

Before the full system works end-to-end, create these files manually in Obsidian:

- `Claude/profile.md` — who you are, background, preferences
- `Claude/active-projects.md` — current projects and goals

The sync script creates `Claude/memory/` on first run. Until the bootstrap files exist, `get_context` returns graceful placeholder strings.
