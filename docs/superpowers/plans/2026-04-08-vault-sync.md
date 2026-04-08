# Vault Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional sync between a local Obsidian vault and a GitHub repository, triggered automatically by the existing polling loop.

**Architecture:** A `VaultSyncEngine` compares SHA hashes from both `LocalVaultClient` and `GitHubVaultClient` against a stored snapshot to determine which files changed on which side. Sync is toggled via `vault-config.json` and runs only when the app is local (not Vercel). The Settings UI is updated to show both vault connections and sync status.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, existing `VaultClient` interface

**Spec:** `docs/superpowers/specs/2026-04-08-vault-sync-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/vault-sync.ts` | Create | Sync engine: diff algorithm, snapshot read/write, execute sync actions |
| `lib/__tests__/vault-sync.test.ts` | Create | Unit tests for sync engine |
| `lib/vault-config.ts` | Modify | Add `syncEnabled` to config type, settings resolution, and read/write |
| `app/api/vault/sync/route.ts` | Create | POST (run sync) and GET (last result) API endpoints |
| `app/api/vault/config/route.ts` | Modify | Include `syncEnabled` + both vault configs in GET/POST |
| `components/SettingsModal.tsx` | Modify | Dual vault config, sync toggle, status display, explainer |
| `app/page.tsx` | Modify | Extend polling to call sync endpoint when enabled |
| `.gitignore` | Modify | Add `vault-sync-state.json` |

---

### Task 1: Extend vault config with syncEnabled

**Files:**
- Modify: `web/lib/vault-config.ts`
- Test: `web/lib/__tests__/vault-config.test.ts`

- [ ] **Step 1: Write tests for syncEnabled in config**

Create `web/lib/__tests__/vault-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

// vault-config.ts reads from process.cwd(), so we need to mock or
// write to the actual cwd. We'll test resolveVaultSettings logic.

describe('resolveVaultSettings', () => {
  const configPath = join(process.cwd(), 'vault-config.json')
  const original = existsSync(configPath) ? require('fs').readFileSync(configPath, 'utf-8') : null

  afterEach(() => {
    // Restore original config
    if (original) {
      writeFileSync(configPath, original)
    } else if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
    vi.unstubAllEnvs()
  })

  it('syncEnabled is false when not set in config', async () => {
    writeFileSync(configPath, JSON.stringify({ mode: 'local', vaultPath: '/tmp/vault' }))
    // Re-import to pick up new config
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(false)
  })

  it('syncEnabled is true when config has it and both vaults configured', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_test')
    vi.stubEnv('VERCEL', undefined as any)
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      vaultPath: '/tmp/vault',
      owner: 'user',
      repo: 'vault',
      syncEnabled: true,
    }))
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(true)
  })

  it('syncEnabled is false on Vercel even when configured', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_test')
    vi.stubEnv('VERCEL', '1')
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      vaultPath: '/tmp/vault',
      owner: 'user',
      repo: 'vault',
      syncEnabled: true,
    }))
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/__tests__/vault-config.test.ts`
Expected: FAIL — `syncEnabled` not in return type.

- [ ] **Step 3: Implement syncEnabled in vault-config.ts**

In `web/lib/vault-config.ts`:

1. Add `syncEnabled?: boolean` to `VaultConfigFile` interface.
2. In `resolveVaultSettings()`, after the existing return logic, add `syncEnabled` to every return object:

```typescript
// At the top of resolveVaultSettings, after reading file config:
const syncCandidate = file.syncEnabled === true
  && !!vaultPath
  && !!owner && !!repo && !!pat
  && !process.env.VERCEL
```

Add `syncEnabled: syncCandidate` to each return statement (including `unconfigured` which always returns `false`).

3. Add `syncEnabled` to `writeVaultConfig` — no changes needed since it already writes the full object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/__tests__/vault-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/vault-config.ts web/lib/__tests__/vault-config.test.ts
git commit -m "feat: add syncEnabled to vault config"
```

---

### Task 2: Sync engine — snapshot and diff

**Files:**
- Create: `web/lib/vault-sync.ts`
- Create: `web/lib/__tests__/vault-sync.test.ts`

This is the core task. The sync engine is a pure function that takes two file trees + a snapshot and returns a list of actions to perform.

- [ ] **Step 1: Write tests for the diff algorithm**

Create `web/lib/__tests__/vault-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeSyncActions } from '../vault-sync'

// computeSyncActions(localTree, remoteTree, snapshot) => SyncAction[]

describe('computeSyncActions', () => {
  it('returns empty actions when nothing changed', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local = [{ path: 'a.md', sha: 'sha1' }]
    const remote = [{ path: 'a.md', sha: 'sha1' }]
    expect(computeSyncActions(local, remote, snapshot)).toEqual([])
  })

  it('pushes locally changed file to remote', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'new' }]
    const remote = [{ path: 'a.md', sha: 'old' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'a.md' }])
  })

  it('pulls remotely changed file to local', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'old' }]
    const remote = [{ path: 'a.md', sha: 'new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'a.md' }])
  })

  it('detects conflict when both sides changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'local-new' }]
    const remote = [{ path: 'a.md', sha: 'remote-new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'conflict', path: 'a.md' }])
  })

  it('pushes new local file', () => {
    const snapshot = {}
    const local = [{ path: 'new.md', sha: 'abc' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'new.md' }])
  })

  it('pulls new remote file', () => {
    const snapshot = {}
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'new.md', sha: 'abc' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'new.md' }])
  })

  it('deletes remote when local deleted and remote unchanged', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'a.md', sha: 'sha1' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'delete-remote', path: 'a.md' }])
  })

  it('deletes local when remote deleted and local unchanged', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local = [{ path: 'a.md', sha: 'sha1' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'delete-local', path: 'a.md' }])
  })

  it('pulls when local deleted but remote was changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'a.md', sha: 'new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'a.md' }])
  })

  it('pushes when remote deleted but local was changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'new' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'a.md' }])
  })

  it('skips both deleted (was in snapshot, now gone from both)', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local: { path: string; sha: string }[] = []
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })

  it('skips new file that exists on both sides with same SHA', () => {
    const snapshot = {}
    const local = [{ path: 'a.md', sha: 'same' }]
    const remote = [{ path: 'a.md', sha: 'same' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })

  it('marks conflict for new file on both sides with different SHA', () => {
    const snapshot = {}
    const local = [{ path: 'a.md', sha: 'local' }]
    const remote = [{ path: 'a.md', sha: 'remote' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'conflict', path: 'a.md' }])
  })

  it('excludes .conflict.md files from actions', () => {
    const snapshot = {}
    const local = [{ path: 'a.conflict.md', sha: 'abc' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/__tests__/vault-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement computeSyncActions**

Create `web/lib/vault-sync.ts`:

```typescript
export type SyncActionType = 'push' | 'pull' | 'conflict' | 'delete-local' | 'delete-remote'

export interface SyncAction {
  type: SyncActionType
  path: string
}

export interface SyncSnapshot {
  lastSync: string
  files: Record<string, string>
}

export interface SyncResult {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  deleted: number
  conflictFiles: string[]
  timestamp: string
}

type TreeEntry = { path: string; sha: string }

export function computeSyncActions(
  localTree: TreeEntry[],
  remoteTree: TreeEntry[],
  snapshotFiles: Record<string, string>,
): SyncAction[] {
  const localMap = new Map(localTree.map(f => [f.path, f.sha]))
  const remoteMap = new Map(remoteTree.map(f => [f.path, f.sha]))

  // Collect all known paths
  const allPaths = new Set([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...Object.keys(snapshotFiles),
  ])

  const actions: SyncAction[] = []

  for (const path of allPaths) {
    if (path.endsWith('.conflict.md')) continue

    const localSha = localMap.get(path) ?? null
    const remoteSha = remoteMap.get(path) ?? null
    const snapSha = snapshotFiles[path] ?? null

    const localChanged = localSha !== snapSha
    const remoteChanged = remoteSha !== snapSha

    // Both present
    if (localSha && remoteSha) {
      if (localSha === remoteSha) continue // identical
      if (localChanged && !remoteChanged) {
        actions.push({ type: 'push', path })
      } else if (!localChanged && remoteChanged) {
        actions.push({ type: 'pull', path })
      } else {
        // Both changed
        actions.push({ type: 'conflict', path })
      }
      continue
    }

    // Only local exists
    if (localSha && !remoteSha) {
      if (snapSha) {
        // Was in snapshot, now gone from remote
        if (localChanged) {
          actions.push({ type: 'push', path }) // local edited, remote deleted → push
        } else {
          actions.push({ type: 'delete-local', path }) // remote deleted, local untouched
        }
      } else {
        actions.push({ type: 'push', path }) // new local file
      }
      continue
    }

    // Only remote exists
    if (!localSha && remoteSha) {
      if (snapSha) {
        // Was in snapshot, now gone from local
        if (remoteChanged) {
          actions.push({ type: 'pull', path }) // remote edited, local deleted → pull
        } else {
          actions.push({ type: 'delete-remote', path }) // local deleted, remote untouched
        }
      } else {
        actions.push({ type: 'pull', path }) // new remote file
      }
      continue
    }

    // Neither exists (both deleted) — skip
  }

  return actions
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/__tests__/vault-sync.test.ts`
Expected: PASS (all 14 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/vault-sync.ts web/lib/__tests__/vault-sync.test.ts
git commit -m "feat: sync engine diff algorithm with tests"
```

---

### Task 3: Sync engine — snapshot persistence and executeSync

**Files:**
- Modify: `web/lib/vault-sync.ts`
- Modify: `web/lib/__tests__/vault-sync.test.ts`

This task adds snapshot read/write and the `executeSync` function that orchestrates reading both vaults, computing actions, executing them, and saving the snapshot.

- [ ] **Step 1: Write tests for snapshot persistence and executeSync**

Add to `web/lib/__tests__/vault-sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readSnapshot, writeSnapshot, executeSync } from '../vault-sync'
import { LocalVaultClient } from '../local'

describe('readSnapshot / writeSnapshot', () => {
  const dir = join(tmpdir(), `sync-snap-${Date.now()}`)

  beforeEach(() => mkdirSync(dir, { recursive: true }))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns empty snapshot when file does not exist', () => {
    const snap = readSnapshot(join(dir, 'nonexistent.json'))
    expect(snap).toEqual({ lastSync: '', files: {} })
  })

  it('round-trips snapshot data', () => {
    const path = join(dir, 'state.json')
    const data = { lastSync: '2026-01-01T00:00:00Z', files: { 'a.md': 'sha1' } }
    writeSnapshot(path, data)
    expect(readSnapshot(path)).toEqual(data)
  })
})

describe('executeSync', () => {
  let localDir: string
  let remoteDir: string
  let snapshotPath: string

  beforeEach(() => {
    const base = join(tmpdir(), `sync-exec-${Date.now()}`)
    localDir = join(base, 'local')
    remoteDir = join(base, 'remote')
    snapshotPath = join(base, 'sync-state.json')
    mkdirSync(localDir, { recursive: true })
    mkdirSync(remoteDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(join(localDir, '..'), { recursive: true, force: true })
  })

  it('first sync creates snapshot without actions', async () => {
    writeFileSync(join(localDir, 'a.md'), 'local content')
    writeFileSync(join(remoteDir, 'b.md'), 'remote content')

    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pushed).toBe(0)
    expect(result.pulled).toBe(0)
    expect(result.conflicts).toBe(0)
    expect(existsSync(snapshotPath)).toBe(true)
  })

  it('second sync pushes locally added file', async () => {
    // Initial sync
    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    // Add local file
    writeFileSync(join(localDir, 'new.md'), '# New')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pushed).toBe(1)
    // File should now exist in remote
    const remoteContent = readFileSync(join(remoteDir, 'new.md'), 'utf-8')
    expect(remoteContent).toBe('# New')
  })

  it('second sync pulls remotely added file', async () => {
    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    writeFileSync(join(remoteDir, 'remote-new.md'), '# Remote')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pulled).toBe(1)
    const localContent = readFileSync(join(localDir, 'remote-new.md'), 'utf-8')
    expect(localContent).toBe('# Remote')
  })

  it('creates conflict file when both sides changed', async () => {
    writeFileSync(join(localDir, 'shared.md'), 'original')
    writeFileSync(join(remoteDir, 'shared.md'), 'original')

    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    // Both sides change
    writeFileSync(join(localDir, 'shared.md'), 'local edit')
    writeFileSync(join(remoteDir, 'shared.md'), 'remote edit')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.conflicts).toBe(1)
    expect(result.conflictFiles).toEqual(['shared.md'])
    // Local wins
    const localContent = readFileSync(join(localDir, 'shared.md'), 'utf-8')
    expect(localContent).toBe('local edit')
    // Remote version saved as conflict
    const conflictContent = readFileSync(join(localDir, 'shared.conflict.md'), 'utf-8')
    expect(conflictContent).toBe('remote edit')
    // Remote overwritten with local
    const remoteContent = readFileSync(join(remoteDir, 'shared.md'), 'utf-8')
    expect(remoteContent).toBe('local edit')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/__tests__/vault-sync.test.ts`
Expected: FAIL — `readSnapshot`, `writeSnapshot`, `executeSync` not exported.

- [ ] **Step 3: Implement snapshot persistence and executeSync**

Add to `web/lib/vault-sync.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { VaultClient } from './vault-client'

export function readSnapshot(path: string): SyncSnapshot {
  if (!existsSync(path)) return { lastSync: '', files: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { lastSync: '', files: {} }
  }
}

export function writeSnapshot(path: string, snapshot: SyncSnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
}

export async function executeSync(
  localClient: VaultClient,
  remoteClient: VaultClient,
  snapshotPath: string,
): Promise<SyncResult> {
  const snapshot = readSnapshot(snapshotPath)
  const [localTree, remoteTree] = await Promise.all([
    localClient.getMarkdownTree(),
    remoteClient.getMarkdownTree(),
  ])

  // First sync: create snapshot only, no actions
  if (!snapshot.lastSync) {
    const files: Record<string, string> = {}
    for (const f of localTree) files[f.path] = f.sha
    for (const f of remoteTree) {
      if (!files[f.path]) files[f.path] = f.sha
    }
    const now = new Date().toISOString()
    writeSnapshot(snapshotPath, { lastSync: now, files })
    return { ok: true, pushed: 0, pulled: 0, conflicts: 0, deleted: 0, conflictFiles: [], timestamp: now }
  }

  const actions = computeSyncActions(localTree, remoteTree, snapshot.files)

  let pushed = 0, pulled = 0, conflicts = 0, deleted = 0
  const conflictFiles: string[] = []

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'push': {
          const { content, sha } = await localClient.readFile(action.path)
          // Try to get remote SHA for update, null for new file
          let remoteSha: string | null = null
          try {
            const remote = await remoteClient.readFile(action.path)
            remoteSha = remote.sha
          } catch { /* new file */ }
          await remoteClient.writeFile(action.path, content, remoteSha, `sync: push ${action.path}`)
          pushed++
          break
        }
        case 'pull': {
          const { content, sha } = await remoteClient.readFile(action.path)
          let localSha: string | null = null
          try {
            const local = await localClient.readFile(action.path)
            localSha = local.sha
          } catch { /* new file */ }
          await localClient.writeFile(action.path, content, localSha, `sync: pull ${action.path}`)
          pulled++
          break
        }
        case 'conflict': {
          const [localFile, remoteFile] = await Promise.all([
            localClient.readFile(action.path),
            remoteClient.readFile(action.path),
          ])
          // Save remote version as .conflict.md locally
          const conflictPath = action.path.replace(/\.md$/, '.conflict.md')
          await localClient.writeFile(conflictPath, remoteFile.content, null, `sync: conflict ${action.path}`)
          // Push local version to remote (local wins)
          await remoteClient.writeFile(action.path, localFile.content, remoteFile.sha, `sync: resolve conflict ${action.path}`)
          conflicts++
          conflictFiles.push(action.path)
          break
        }
        case 'delete-remote': {
          const { sha } = await remoteClient.readFile(action.path)
          await remoteClient.deleteFile(action.path, sha, `sync: delete ${action.path}`)
          deleted++
          break
        }
        case 'delete-local': {
          const { sha } = await localClient.readFile(action.path)
          await localClient.deleteFile(action.path, sha, `sync: delete ${action.path}`)
          deleted++
          break
        }
      }
    } catch {
      // Individual file error — skip, retry next cycle
    }
  }

  // Build new snapshot from current state of both vaults
  const [newLocalTree, newRemoteTree] = await Promise.all([
    localClient.getMarkdownTree(),
    remoteClient.getMarkdownTree(),
  ])
  const newFiles: Record<string, string> = {}
  for (const f of newLocalTree) newFiles[f.path] = f.sha
  for (const f of newRemoteTree) {
    if (!newFiles[f.path]) newFiles[f.path] = f.sha
  }
  const now = new Date().toISOString()
  writeSnapshot(snapshotPath, { lastSync: now, files: newFiles })

  return { ok: true, pushed, pulled, conflicts, deleted, conflictFiles, timestamp: now }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/__tests__/vault-sync.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/vault-sync.ts web/lib/__tests__/vault-sync.test.ts
git commit -m "feat: sync engine snapshot persistence and executeSync"
```

---

### Task 4: Sync API endpoints

**Files:**
- Create: `web/app/api/vault/sync/route.ts`
- Modify: `web/app/api/vault/config/route.ts`
- Modify: `web/.gitignore`

- [ ] **Step 1: Add vault-sync-state.json to .gitignore**

In `web/.gitignore`, after the `vault-config.json` line, add:

```
vault-sync-state.json
```

- [ ] **Step 2: Create sync API route**

Create `web/app/api/vault/sync/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { resolveVaultSettings } from '@/lib/vault-config'
import { LocalVaultClient } from '@/lib/local'
import { GitHubVaultClient } from '@/lib/github'
import { executeSync, readSnapshot } from '@/lib/vault-sync'
import { invalidateCache } from '@/lib/graph-cache'
import { join } from 'path'

const SNAPSHOT_PATH = join(process.cwd(), 'vault-sync-state.json')

let syncInFlight = false

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  if (!settings.syncEnabled) {
    return NextResponse.json({ ok: false, reason: 'sync_disabled' }, { status: 422 })
  }

  if (syncInFlight) {
    return NextResponse.json({ ok: false, reason: 'sync_in_progress' })
  }

  syncInFlight = true
  try {
    const localClient = new LocalVaultClient(settings.vaultPath!)
    const remoteClient = new GitHubVaultClient({
      pat: settings.pat!,
      owner: settings.owner!,
      repo: settings.repo!,
      branch: settings.branch,
    })

    const result = await executeSync(localClient, remoteClient, SNAPSHOT_PATH)
    if (result.pushed > 0 || result.pulled > 0 || result.deleted > 0) {
      invalidateCache()
    }
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  } finally {
    syncInFlight = false
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  const snapshot = readSnapshot(SNAPSHOT_PATH)

  return NextResponse.json({
    syncEnabled: settings.syncEnabled,
    lastSync: snapshot.lastSync || null,
    fileCount: Object.keys(snapshot.files).length,
  })
}
```

- [ ] **Step 3: Extend config route to include syncEnabled and both vault configs**

In `web/app/api/vault/config/route.ts`:

**GET handler:** Add `syncEnabled`, `vaultPath`, `owner`, `repo` to all response objects so the frontend always knows both connections.

Change the GET handler to always return all fields:

```typescript
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = resolveVaultSettings()
  const graph = getCachedGraphIfAvailable()
  const fileConfig = readVaultConfig()

  return NextResponse.json({
    mode: settings.mode,
    vaultPath: settings.vaultPath ?? null,
    owner: settings.owner ?? null,
    repo: settings.repo ?? null,
    branch: settings.branch ?? 'main',
    repoUrl: settings.owner && settings.repo
      ? `https://github.com/${settings.owner}/${settings.repo}`
      : null,
    noteCount: graph?.nodes.length ?? null,
    configSource: fileConfig.mode ? 'file' : 'env',
    syncEnabled: settings.syncEnabled,
  })
}
```

**POST handler:** Accept `syncEnabled` boolean:

After the existing `if (mode === 'github')` block, before the `else` error, handle `syncEnabled`:

```typescript
// Inside POST, after parsing body:
const { mode, vaultPath, owner, repo, branch, syncEnabled } = body

// In the writeVaultConfig calls, include syncEnabled:
// For local:
writeVaultConfig({ mode: 'local', vaultPath: vaultPath.trim(), ...preserveOtherFields(syncEnabled) })
// For github:
writeVaultConfig({ mode: 'github', owner: owner.trim(), repo: repo.trim(), branch: (branch ?? 'main').trim(), ...preserveOtherFields(syncEnabled) })
```

The key insight: when saving mode=local, preserve existing GitHub fields (owner/repo/branch) so sync can use them. And vice versa. Read the current config first, merge the new fields on top:

```typescript
const currentConfig = readVaultConfig()
if (mode === 'local') {
  writeVaultConfig({
    ...currentConfig,
    mode: 'local',
    vaultPath: vaultPath.trim(),
    ...(syncEnabled !== undefined ? { syncEnabled } : {}),
  })
} else if (mode === 'github') {
  writeVaultConfig({
    ...currentConfig,
    mode: 'github',
    owner: owner.trim(),
    repo: repo.trim(),
    branch: (branch ?? 'main').trim(),
    ...(syncEnabled !== undefined ? { syncEnabled } : {}),
  })
}
```

Also support a PATCH-like update for just toggling sync:

```typescript
// After the github block, add:
if (mode === undefined && syncEnabled !== undefined) {
  writeVaultConfig({ ...currentConfig, syncEnabled })
  invalidateCache()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd web && npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/vault/sync/route.ts web/app/api/vault/config/route.ts web/.gitignore
git commit -m "feat: sync API endpoints and config extension"
```

---

### Task 5: Settings UI — dual vault config + sync toggle

**Files:**
- Modify: `web/components/SettingsModal.tsx`

This task rewrites the vault section of the Settings modal to always show both local and GitHub configuration, adds the sync toggle, and shows sync status.

- [ ] **Step 1: Update VaultConfig interface**

At the top of `SettingsModal.tsx`, update the interface:

```typescript
interface VaultConfig {
  mode: 'local' | 'github' | 'unconfigured'
  vaultPath?: string | null
  owner?: string | null
  repo?: string | null
  branch?: string
  repoUrl?: string | null
  noteCount?: number | null
  configSource?: 'file' | 'env'
  syncEnabled?: boolean
}

interface SyncStatus {
  syncEnabled: boolean
  lastSync: string | null
  fileCount: number
}
```

- [ ] **Step 2: Replace the editing state with dual-field editing**

Remove the `editMode` toggle (GitHub/Local). Instead, always show both sections:

1. **Local vault** section with path input
2. **GitHub repo** section with URL + branch inputs
3. **Primary source** selector — radio or segmented control to set `mode` (which vault the graph reads from)
4. **Auto-sync toggle** — visible when both are configured

- [ ] **Step 3: Add sync status fetching**

Add state and fetch for sync status:

```typescript
const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)

// In the useEffect that fetches config, also fetch sync status:
fetch('/api/vault/sync').then(r => r.json()).then(setSyncStatus)
```

- [ ] **Step 4: Add sync toggle handler**

```typescript
async function handleSyncToggle(enabled: boolean) {
  await fetch('/api/vault/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ syncEnabled: enabled }),
  })
  const updated = await fetch('/api/vault/config').then(r => r.json())
  setConfig(updated)
  const status = await fetch('/api/vault/sync').then(r => r.json())
  setSyncStatus(status)
}
```

- [ ] **Step 5: Implement the vault config UI**

Replace the existing vault section (the `bg-slate-50` block) with:

```
┌─────────────────────────────────────┐
│  VAULT                              │
│                                     │
│  Local path                    Edit │
│  /Users/milan/vault                 │
│                                     │
│  GitHub repository             Edit │
│  milanvanbruggen/superbrain-vault   │
│  branch: main                       │
│                                     │
│  Primary source: [Local] [GitHub]   │
│                                     │
│  ─────────────────────────────────  │
│  Auto-sync                  [toggle]│
│  Houdt lokale vault en GitHub       │
│  automatisch in sync. Lokaal is     │
│  leidend bij conflicten.            │
│                                     │
│  Laatste sync: 2 min geleden        │
│  ↑ 3 pushed  ↓ 1 pulled            │
│                                     │
│  ▸ Hoe werkt sync?                  │
│    (expandable explanation)         │
└─────────────────────────────────────┘
```

The sync toggle is disabled (grayed out) when both vaults are not configured, with helper text explaining what's needed.

- [ ] **Step 6: Add sync explainer collapsible**

Below the sync status, add a `<details>` or state-toggled block:

```
Superbrain vergelijkt elke paar seconden de bestanden in je lokale vault
met GitHub. Nieuwe en gewijzigde bestanden worden automatisch
gesynchroniseerd. Als hetzelfde bestand op beide plekken is gewijzigd,
wint de lokale versie en wordt de remote versie bewaard als
.conflict.md bestand.
```

- [ ] **Step 7: Add conflict warning**

When `syncStatus` has conflict info (from last sync result stored in state), show an amber warning listing the conflict files.

- [ ] **Step 8: Update handleSave to preserve both vault configs**

The save handler should read the current config, merge the edited fields, and write back — so saving a local path doesn't wipe the GitHub config and vice versa.

- [ ] **Step 9: Manually test the Settings UI**

Open the app, go to Settings. Verify:
- Both local and GitHub sections are visible
- Editing one doesn't wipe the other
- Sync toggle appears when both are configured
- Sync status shows after enabling

- [ ] **Step 10: Commit**

```bash
git add web/components/SettingsModal.tsx
git commit -m "feat: settings UI with dual vault config and sync toggle"
```

---

### Task 6: Extend polling to trigger sync

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Fetch sync config on load**

Add state to track whether sync is enabled:

```typescript
const [syncEnabled, setSyncEnabled] = useState(false)
```

In the `loadGraph` function, after successfully loading the graph, also check sync status:

```typescript
fetch('/api/vault/sync').then(r => r.json()).then(data => {
  setSyncEnabled(data.syncEnabled ?? false)
}).catch(() => {})
```

- [ ] **Step 2: Modify refreshGraphSilently to call sync when enabled**

```typescript
async function refreshGraphSilently() {
  try {
    if (syncEnabled) {
      // Trigger sync — this handles both directions
      const syncRes = await fetch('/api/vault/sync', { method: 'POST' })
      if (syncRes.ok) {
        const syncData = await syncRes.json()
        if (syncData.pushed > 0 || syncData.pulled > 0 || syncData.deleted > 0 || syncData.conflicts > 0) {
          // Something changed — reload graph
          const graphRes = await fetch('/api/vault/graph')
          if (graphRes.ok) {
            const data: VaultGraph = await graphRes.json()
            setGraph(data)
            setVaultError(null)
            setError(null)
          }
        }
      }
      return
    }

    // Existing hash-based polling for non-sync mode
    const res = await fetch('/api/vault/hash')
    // ... (keep existing logic)
  } catch {
    // Silent
  }
}
```

- [ ] **Step 3: Re-check syncEnabled when settings close**

When the Settings modal closes, refresh the sync state:

```typescript
// In the SettingsModal onClose handler (already calls loadGraph):
fetch('/api/vault/sync').then(r => r.json()).then(data => {
  setSyncEnabled(data.syncEnabled ?? false)
}).catch(() => {})
```

- [ ] **Step 4: Manually test end-to-end**

1. Configure both local vault and GitHub repo in Settings
2. Enable auto-sync
3. Add a file to the local vault (via Obsidian or filesystem)
4. Wait ~5 seconds — file should appear in GitHub repo
5. Add a file via GitHub — should appear locally after ~5 seconds
6. Graph should update automatically

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat: extend polling to trigger vault sync"
```
