# Local Vault Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct GitHub API vault import with an abstract `VaultClient` interface, add a `LocalVaultClient` that reads from the local filesystem, and wire up a factory that selects the right implementation based on env vars.

**Architecture:** A shared `VaultClient` interface lives in `web/lib/vault-client.ts` alongside a `getVaultClient()` factory. `LocalVaultClient` in `web/lib/local.ts` reads/writes the filesystem. The existing `GitHubVaultClient` in `web/lib/github.ts` keeps its logic but loses its factory (moved to `vault-client.ts`). Both API routes update their import from `@/lib/github` to `@/lib/vault-client`.

**Tech Stack:** Node.js `fs/promises`, `crypto` (SHA-1 hash), TypeScript, Vitest, Next.js 16 API routes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `web/lib/vault-client.ts` | Create | `VaultClient` interface + `getVaultClient()` factory |
| `web/lib/local.ts` | Create | `LocalVaultClient` — reads/writes local filesystem |
| `web/lib/__tests__/local.test.ts` | Create | Unit tests for `LocalVaultClient` |
| `web/lib/github.ts` | Modify | Remove `getVaultClient()` export only — no `implements` keyword (see Task 1 Step 4) |
| `web/app/api/vault/graph/route.ts` | Modify | Change import from `@/lib/github` to `@/lib/vault-client` |
| `web/app/api/vault/note/[...path]/route.ts` | Modify | Change import from `@/lib/github` to `@/lib/vault-client` |

---

### Task 1: VaultClient interface + factory

**Files:**
- Create: `web/lib/vault-client.ts`
- Modify: `web/lib/github.ts` (lines 74–87: remove `getVaultClient` only)

- [ ] **Step 1: Write the failing test**

Add to a new file `web/lib/__tests__/vault-client.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('getVaultClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules() // required: prevents module cache from leaking stubbed env vars between tests
  })

  it('throws when neither VAULT_PATH nor GitHub vars are set', async () => {
    vi.stubEnv('VAULT_PATH', '')
    vi.stubEnv('GITHUB_PAT', '')
    vi.stubEnv('GITHUB_VAULT_OWNER', '')
    vi.stubEnv('GITHUB_VAULT_REPO', '')
    const { getVaultClient } = await import('../vault-client')
    expect(() => getVaultClient()).toThrow()
  })

  it('returns LocalVaultClient when VAULT_PATH is set', async () => {
    vi.stubEnv('VAULT_PATH', '/tmp/vault')
    vi.stubEnv('GITHUB_PAT', '')
    const { getVaultClient } = await import('../vault-client')
    const client = getVaultClient()
    expect(client.constructor.name).toBe('LocalVaultClient')
  })

  it('returns GitHubVaultClient when only GitHub vars are set', async () => {
    vi.stubEnv('VAULT_PATH', '')
    vi.stubEnv('GITHUB_PAT', 'token')
    vi.stubEnv('GITHUB_VAULT_OWNER', 'owner')
    vi.stubEnv('GITHUB_VAULT_REPO', 'repo')
    const { getVaultClient } = await import('../vault-client')
    const client = getVaultClient()
    expect(client.constructor.name).toBe('GitHubVaultClient')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run lib/__tests__/vault-client.test.ts
```

Expected: FAIL — `Cannot find module '../vault-client'`

- [ ] **Step 3: Create `web/lib/vault-client.ts`**

```typescript
import { GitHubVaultClient } from './github'
import { LocalVaultClient } from './local'

export interface VaultClient {
  getMarkdownTree(): Promise<{ path: string; sha: string }[]>
  readFile(path: string): Promise<{ content: string; sha: string }>
  writeFile(path: string, content: string, sha: string | null, message: string): Promise<void>
}

export function getVaultClient(): VaultClient {
  const vaultPath = process.env.VAULT_PATH
  if (vaultPath) {
    return new LocalVaultClient(vaultPath)
  }

  const pat = process.env.GITHUB_PAT
  const owner = process.env.GITHUB_VAULT_OWNER
  const repo = process.env.GITHUB_VAULT_REPO
  if (pat && owner && repo) {
    return new GitHubVaultClient({
      pat,
      owner,
      repo,
      branch: process.env.GITHUB_VAULT_BRANCH,
    })
  }

  throw new Error(
    'No vault configured. Set VAULT_PATH for local mode, or GITHUB_PAT + GITHUB_VAULT_OWNER + GITHUB_VAULT_REPO for GitHub mode.'
  )
}
```

- [ ] **Step 4: Update `web/lib/github.ts`**

Remove the `getVaultClient` function (lines 74–87) and add `implements VaultClient` to the class declaration. The file needs to import `VaultClient` from the new module — but that would create a circular import. To avoid this, do NOT use `implements VaultClient` in the class signature. The TypeScript structural type system will enforce compatibility at the factory without an explicit `implements`. Simply delete the `getVaultClient` export from `github.ts`.

The updated end of `web/lib/github.ts` should be:

```typescript
  async writeFile(path: string, content: string, sha: string | null, message: string): Promise<void> {
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content).toString('base64'),
    }
    if (sha) body.sha = sha

    const res = await fetch(`${this.base}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`Failed to write file ${path}: ${JSON.stringify(err)}`)
    }
  }
}
```

(Remove the entire `getVaultClient` function that follows the class closing brace.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && npx vitest run lib/__tests__/vault-client.test.ts
```

Expected: PASS — 3 tests pass

Note: The dynamic `import('../vault-client')` pattern combined with `vi.resetModules()` in `afterEach` ensures each test gets a fresh module evaluation with the correct stubbed env vars.

- [ ] **Step 6: Verify existing GitHub tests still pass**

```bash
cd web && npx vitest run lib/__tests__/github.test.ts
```

Expected: PASS — 4 tests pass (unchanged)

- [ ] **Step 7: Commit**

```bash
cd web && git add lib/vault-client.ts lib/__tests__/vault-client.test.ts lib/github.ts
git commit -m "feat: add VaultClient interface and getVaultClient factory"
```

---

### Task 2: LocalVaultClient

**Files:**
- Create: `web/lib/local.ts`
- Create: `web/lib/__tests__/local.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// web/lib/__tests__/local.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { LocalVaultClient } from '../local'

let vaultDir: string
let client: LocalVaultClient

beforeEach(() => {
  vaultDir = join(tmpdir(), `vault-test-${Date.now()}`)
  mkdirSync(vaultDir, { recursive: true })
  client = new LocalVaultClient(vaultDir)
})

afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true })
})

describe('LocalVaultClient', () => {
  it('getMarkdownTree returns all .md files recursively', async () => {
    mkdirSync(join(vaultDir, 'people'))
    writeFileSync(join(vaultDir, 'README.md'), '# Hello')
    writeFileSync(join(vaultDir, 'people', 'Milan.md'), '# Milan')
    writeFileSync(join(vaultDir, 'people', 'photo.jpg'), 'binary')

    const tree = await client.getMarkdownTree()
    const paths = tree.map(f => f.path).sort()

    expect(paths).toEqual(['README.md', 'people/Milan.md'])
  })

  it('getMarkdownTree returns stable SHA for unchanged files', async () => {
    writeFileSync(join(vaultDir, 'note.md'), '# Note')

    const tree1 = await client.getMarkdownTree()
    const tree2 = await client.getMarkdownTree()

    expect(tree1[0].sha).toBe(tree2[0].sha)
  })

  it('readFile returns content and SHA', async () => {
    writeFileSync(join(vaultDir, 'hello.md'), '# Hello World')

    const result = await client.readFile('hello.md')

    expect(result.content).toBe('# Hello World')
    expect(result.sha).toMatch(/^[a-f0-9]{40}$/) // SHA-1 hex
  })

  it('readFile SHA changes when content changes', async () => {
    writeFileSync(join(vaultDir, 'note.md'), 'version 1')
    const { sha: sha1 } = await client.readFile('note.md')

    writeFileSync(join(vaultDir, 'note.md'), 'version 2')
    const { sha: sha2 } = await client.readFile('note.md')

    expect(sha1).not.toBe(sha2)
  })

  it('readFile throws for missing file', async () => {
    await expect(client.readFile('nonexistent.md')).rejects.toThrow()
  })

  it('writeFile creates a new file', async () => {
    await client.writeFile('new-note.md', '# New', null, 'ignored message')

    const result = await client.readFile('new-note.md')
    expect(result.content).toBe('# New')
  })

  it('writeFile creates parent directories', async () => {
    await client.writeFile('people/Milan.md', '# Milan', null, 'ignored')

    const result = await client.readFile('people/Milan.md')
    expect(result.content).toBe('# Milan')
  })

  it('writeFile overwrites existing file (ignores SHA)', async () => {
    writeFileSync(join(vaultDir, 'note.md'), 'original')

    await client.writeFile('note.md', 'updated', 'any-sha', 'ignored')

    const result = await client.readFile('note.md')
    expect(result.content).toBe('updated')
  })

  it('writeFile throws on path traversal attempt', async () => {
    await expect(
      client.writeFile('../escape.md', 'evil', null, 'hack')
    ).rejects.toThrow(/path traversal/i)
  })

  it('readFile throws on path traversal attempt', async () => {
    await expect(
      client.readFile('../escape.md')
    ).rejects.toThrow(/path traversal/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npx vitest run lib/__tests__/local.test.ts
```

Expected: FAIL — `Cannot find module '../local'`

- [ ] **Step 3: Create `web/lib/local.ts`**

```typescript
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { join, relative, normalize, dirname } from 'path'
import { createHash } from 'crypto'

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

export class LocalVaultClient {
  constructor(private vaultPath: string) {}

  async getMarkdownTree(): Promise<{ path: string; sha: string }[]> {
    const fullPaths = await this.findMarkdownFiles(this.vaultPath)
    return Promise.all(
      fullPaths.map(async fullPath => {
        const content = await readFile(fullPath, 'utf-8')
        const path = relative(this.vaultPath, fullPath)
        return { path, sha: sha1(content) }
      })
    )
  }

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const fullPath = this.resolveSafe(path)
    const content = await readFile(fullPath, 'utf-8')
    return { content, sha: sha1(content) }
  }

  async writeFile(path: string, content: string, _sha: string | null, _message: string): Promise<void> {
    const fullPath = this.resolveSafe(path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  private resolveSafe(path: string): string {
    const fullPath = join(this.vaultPath, path)
    const normalizedFull = normalize(fullPath)
    const normalizedVault = normalize(this.vaultPath)
    if (!normalizedFull.startsWith(normalizedVault + '/') && normalizedFull !== normalizedVault) {
      throw new Error(`Path traversal detected: ${path}`)
    }
    return fullPath
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(dir)
    await Promise.all(
      entries.map(async entry => {
        const fullPath = join(dir, entry)
        const info = await stat(fullPath)
        if (info.isDirectory()) {
          results.push(...(await this.findMarkdownFiles(fullPath)))
        } else if (entry.endsWith('.md')) {
          results.push(fullPath)
        }
      })
    )
    return results
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd web && npx vitest run lib/__tests__/local.test.ts
```

Expected: PASS — 10 tests pass

- [ ] **Step 5: Commit**

```bash
cd web && git add lib/local.ts lib/__tests__/local.test.ts
git commit -m "feat: add LocalVaultClient for filesystem vault access"
```

---

### Task 3: Update API routes

**Files:**
- Modify: `web/app/api/vault/graph/route.ts` (line 4)
- Modify: `web/app/api/vault/note/[...path]/route.ts` (line 4)

- [ ] **Step 1: Update graph route import**

In `web/app/api/vault/graph/route.ts`, change line 4:

```typescript
// Before:
import { getVaultClient } from '@/lib/github'

// After:
import { getVaultClient } from '@/lib/vault-client'
```

- [ ] **Step 2: Update note route import**

In `web/app/api/vault/note/[...path]/route.ts`, change line 4:

```typescript
// Before:
import { getVaultClient } from '@/lib/github'

// After:
import { getVaultClient } from '@/lib/vault-client'
```

- [ ] **Step 3: Run full test suite**

```bash
cd web && npx vitest run
```

Expected: All tests pass (vault-parser, github, local, vault-client)

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd web && git add app/api/vault/graph/route.ts app/api/vault/note/[...path]/route.ts
git commit -m "feat: wire API routes to VaultClient factory"
```

---

### Task 4: Smoke test with local vault

This task has no automated tests — it verifies the running app works with the local Obsidian vault.

- [ ] **Step 1: Confirm `VAULT_PATH` is set in `.env.local`**

Check `web/.env.local` contains:

```
VAULT_PATH=/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain
```

- [ ] **Step 2: Start the dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 3: Open the app and verify**

Open http://localhost:3000. After login:
- The graph should show nodes from the local Obsidian vault
- Clicking a node should show its content in the detail panel
- Editing and saving a note should update the file on disk

- [ ] **Step 4: Verify a file was written to disk**

After editing a note in the app, check the file was updated:

```bash
ls -la "/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain/"
```

- [ ] **Step 5: Commit**

No new files to commit — all changes were in Tasks 1–3. If any files were modified during smoke testing, commit them explicitly:

```bash
cd web && git status
# Stage only intentional changes, never .env.local
git commit -m "feat: local vault adapter complete — app reads from Obsidian vault"
```
