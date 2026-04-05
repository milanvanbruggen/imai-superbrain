# Local Vault Adapter Design

**Date:** 2026-04-05

## Goal

Replace direct GitHub API vault access with an abstract `VaultClient` interface that supports two implementations: local filesystem (primary, for local development with an Obsidian vault) and GitHub API (fallback, for Vercel deployment). The factory selects the implementation based on environment variables.

## Background

The app currently reads and writes vault notes exclusively via the GitHub API. This means the user's local Obsidian vault (on iCloud) is disconnected from the app. The user wants to point the app directly at their local Obsidian vault folder while keeping GitHub as a deployment target for Vercel.

## Architecture

### VaultClient Interface (`web/lib/vault-client.ts`)

A shared TypeScript interface that both implementations satisfy:

```typescript
export interface VaultClient {
  getMarkdownTree(): Promise<{ path: string; sha: string }[]>
  readFile(path: string): Promise<{ content: string; sha: string }>
  writeFile(path: string, content: string, sha: string | null, message: string): Promise<void>
}
```

A factory function `getVaultClient(): VaultClient` selects the implementation:
- If `VAULT_PATH` is set → return `LocalVaultClient`
- Otherwise → return `GitHubVaultClient`

### LocalVaultClient (`web/lib/local.ts`)

Reads from and writes to the local filesystem using Node.js `fs/promises`.

- `getMarkdownTree()` — recursively walks `VAULT_PATH`, returns all `.md` files. SHA is a simple hex hash of the file content (used as cache-buster/ETag, not for conflict detection).
- `readFile(path)` — reads file at `VAULT_PATH/path`, returns content and SHA (hash of content).
- `writeFile(path, content, _sha, _message)` — writes content to `VAULT_PATH/path`. SHA and commit message are ignored in local mode. Creates parent directories with `fs/promises mkdir({ recursive: true })` if needed.

### GitHubVaultClient (`web/lib/github.ts`)

The existing `GitHubVaultClient` class is unchanged except the `getVaultClient()` factory is removed and moved to `vault-client.ts`. The `implements VaultClient` keyword is NOT added to the class — doing so would create a circular import (`github.ts` ↔ `vault-client.ts`). TypeScript's structural type system enforces interface compatibility without the keyword.

### API Routes

`web/app/api/vault/graph/route.ts` and `web/app/api/vault/note/[...path]/route.ts` import `getVaultClient` from `@/lib/vault-client` instead of `@/lib/github`. No other changes needed.

## File Changes

| File | Change |
|---|---|
| `web/lib/vault-client.ts` | New — `VaultClient` interface + `getVaultClient()` factory |
| `web/lib/local.ts` | New — `LocalVaultClient` implementation |
| `web/lib/github.ts` | Remove `getVaultClient()` export; class implements `VaultClient` |
| `web/app/api/vault/graph/route.ts` | Update import to `@/lib/vault-client` |
| `web/app/api/vault/note/[...path]/route.ts` | Update import to `@/lib/vault-client` |

No changes to: UI components, graph cache, vault parser, auth, MCP server, tests for parser/cache.

## Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `VAULT_PATH` | Absolute path to local vault folder | Local mode |
| `GITHUB_PAT` | GitHub personal access token | Vercel/GitHub mode |
| `GITHUB_VAULT_OWNER` | GitHub repo owner | Vercel/GitHub mode |
| `GITHUB_VAULT_REPO` | GitHub repo name | Vercel/GitHub mode |
| `GITHUB_VAULT_BRANCH` | Branch (default: `main`) | Optional |

If both `VAULT_PATH` and GitHub vars are set, `VAULT_PATH` takes priority.

## SHA Handling in Local Mode

GitHub uses SHA for optimistic concurrency (prevents overwriting newer versions). In local mode:
- SHA is a SHA-1 hex hash of the file content at read time (via Node's `crypto.createHash('sha1')`), matching GitHub's blob hashing convention
- On write, the SHA is ignored — writes always overwrite the file
- This is safe for single-user local use

## Error Handling

- `LocalVaultClient.readFile()` throws if the file does not exist (returns 404 from the API route)
- `LocalVaultClient.writeFile()` creates parent directories with `mkdirSync` if needed
- Path traversal is prevented: all paths are resolved relative to `VAULT_PATH` and checked to remain within it
- If neither `VAULT_PATH` nor GitHub vars are configured, `getVaultClient()` throws a clear error

## Testing

- Unit tests for `LocalVaultClient` using a temp directory (`os.tmpdir()`)
- Existing GitHub client tests remain unchanged
- No integration tests required (filesystem access is simple and well-covered by unit tests)
