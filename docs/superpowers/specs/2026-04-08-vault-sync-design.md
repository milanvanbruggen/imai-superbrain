# Vault Sync Design

## Goal

Enable bidirectional synchronization between a local Obsidian vault and a GitHub repository, so changes made in either location are automatically propagated to the other.

## Architecture

Content-hash sync using the existing `VaultClient` interface. No git dependency — works purely at the file level by comparing SHA hashes. A snapshot of the previous sync state is stored locally so the engine can determine which side changed a file.

Sync runs only when the app is hosted locally (not on Vercel). It is triggered by the existing 5-second polling loop.

## Sync Engine — `lib/vault-sync.ts`

### Algorithm

The engine compares three states per file: **local**, **remote**, and **snapshot** (the state at last sync).

| Local vs snapshot | Remote vs snapshot | Action |
|---|---|---|
| Unchanged | Unchanged | Skip |
| Changed | Unchanged | Push local → remote |
| Unchanged | Changed | Pull remote → local |
| Changed | Changed | **Conflict** — local wins, remote version saved as `file.conflict.md` |
| New (not in snapshot) | Does not exist | Push local → remote |
| Does not exist | New (not in snapshot) | Pull remote → local |
| Deleted (was in snapshot) | Unchanged | Delete remote |
| Unchanged | Deleted (was in snapshot) | Delete local |
| Deleted | Changed | Pull remote → local (remote wins — file was actively edited) |
| Changed | Deleted | Push local → remote (local wins — file was actively edited) |

### Snapshot — `vault-sync-state.json`

Stored alongside `vault-config.json` in `process.cwd()`. Structure:

```json
{
  "lastSync": "2026-04-08T12:00:00.000Z",
  "files": {
    "people/Milan van Bruggen.md": "a1b2c3...",
    "projects/Superbrain.md": "d4e5f6..."
  }
}
```

Written after each successful sync. SHA values come from `getMarkdownTree()`.

### Return value — `SyncResult`

```typescript
interface SyncResult {
  pushed: number
  pulled: number
  conflicts: number
  deleted: number
  conflictFiles: string[]
  timestamp: string
}
```

### Conflict files

- When both sides changed the same file, local wins. The remote version is written to `file.conflict.md` in the local vault.
- Files ending in `.conflict.md` are excluded from sync to prevent loops.
- The user resolves conflicts manually by keeping the desired version and deleting the conflict file.

### First sync (no snapshot)

When `vault-sync-state.json` does not exist, the engine creates an initial snapshot from both vaults without performing any sync actions. Files that already exist on both sides with different content are recorded as-is — their divergence is accepted as the baseline. The next cycle will then detect actual changes relative to this baseline. This prevents mass duplication when sync is first enabled.

## Config & Toggle

### `vault-config.json` extension

```json
{
  "mode": "local",
  "vaultPath": "/Users/milan/vault",
  "owner": "milanvanbruggen",
  "repo": "superbrain-vault",
  "branch": "main",
  "syncEnabled": true
}
```

### `resolveVaultSettings()` extension

Returns an additional field `syncEnabled: boolean` that is `true` when:
1. `syncEnabled` is `true` in config
2. Both local (`vaultPath`) and GitHub (`owner` + `repo` + `pat`) credentials are present
3. The app is running locally (not on Vercel — checked via absence of `process.env.VERCEL`)

### Settings UI

The current GitHub/Local toggle is replaced. Both local path and GitHub repo are always shown as input fields. An "Auto-sync" toggle appears when both are configured.

Below the toggle: *"Houdt lokale vault en GitHub automatisch in sync. Lokaal is leidend bij conflicten."*

When sync is active: a status line showing last sync time and result (e.g., "Last sync: 2 min ago — 3 pushed, 1 pulled").

## API Endpoints

### `POST /api/vault/sync`

Executes one sync cycle. Returns:

```json
{
  "ok": true,
  "pushed": 2,
  "pulled": 1,
  "conflicts": 0,
  "deleted": 0,
  "conflictFiles": [],
  "timestamp": "2026-04-08T12:00:00Z"
}
```

Stampede protection: only one sync runs at a time. Concurrent requests are rejected with `{ ok: false, reason: "sync_in_progress" }`.

### `GET /api/vault/sync`

Returns the last sync result (from `vault-sync-state.json`) without triggering a new sync. Used by the Settings UI to display status.

## Sync Trigger

The existing 5-second hash polling in `page.tsx` is extended:

1. Poll `/api/vault/hash` — detects local changes
2. If sync is enabled: call `POST /api/vault/sync` (which also checks remote changes via the GitHub tree)
3. After sync completes: reload the graph to reflect any changes
4. If sync is disabled: fall back to the existing behavior (reload graph on hash change only)

## Error Handling

- **Network/API failures:** Sync is skipped, previous state remains intact. Warning shown in Settings only after 3+ consecutive failures: "Sync tijdelijk niet mogelijk".
- **Individual file errors:** That file is skipped, rest of sync continues. Retried on next cycle.
- **Large vaults:** Only files with changed SHAs are read. Unchanged files are compared by hash from `getMarkdownTree()` only.
- **Disabling sync:** Snapshot is preserved. Re-enabling picks up from where it left off.

## Files

| File | Action | Purpose |
|---|---|---|
| `lib/vault-sync.ts` | Create | Sync engine with diff algorithm |
| `lib/vault-config.ts` | Modify | Add `syncEnabled` field to config and settings resolution |
| `app/api/vault/sync/route.ts` | Create | POST (run sync) and GET (last result) endpoints |
| `app/api/vault/config/route.ts` | Modify | Include `syncEnabled` in GET response and POST handling |
| `components/SettingsModal.tsx` | Modify | Replace mode toggle with dual config + sync toggle + status |
| `app/page.tsx` | Modify | Extend polling to trigger sync when enabled |
| `vault-sync-state.json` | Runtime | Snapshot file (gitignored) |
| `.gitignore` | Modify | Add `vault-sync-state.json` |
