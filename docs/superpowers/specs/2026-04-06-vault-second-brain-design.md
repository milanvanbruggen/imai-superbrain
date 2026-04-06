# Vault as Second Brain Design

## Goal

Extend the Superbrain system so that Claude Code's persistent memory is visible and editable in Obsidian, and Claude Cowork can dynamically retrieve personal context from the vault. The vault becomes the single source of truth for personal/cross-project context.

## Context

The Superbrain project has an MCP server at `/api/mcp` (deployed on Vercel) with five tools: `list_notes`, `search_notes`, `read_note`, `write_note`, `get_related`. Claude Code (CLI) has its own local memory system at `~/.claude/projects/.../memory/`. These two systems currently don't communicate.

The vault lives at `/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain` (local, iCloud-backed) and is also accessible via GitHub (`GITHUB_VAULT_REPO=superbrain-vault`). Local vault takes priority when `VAULT_PATH` is set.

## Architecture

Two independent components:

**Component 1 — Sync script**: bidirectional rsync between Claude Code's local memory directory and `Claude/memory/` in the vault. Last-modified-wins. Triggered automatically after Claude Code memory writes via a `PostToolUse` hook, and run vault → local at session start via a CLAUDE.md instruction.

**Component 2 — MCP context tool**: a new `get_context(topic?)` tool in the existing MCP server. Reads the vault's `Claude/` section and returns personal context as structured text. Used by Claude Cowork to load context at the start of a conversation.

These components are independent — the sync script requires no server changes, and the MCP tool works regardless of whether the sync script is active.

## Vault Structure

```
Claude/
  profile.md           — who Milan is: background, stack, communication preferences
  active-projects.md   — current projects, goals, deadlines
  memory/
    user.md            — Claude's learned insights about Milan (role, expertise, preferences)
    feedback.md        — corrections and behavioral guidance given to Claude
    project.md         — cross-project context Claude has accumulated
    reference.md       — external resources, tools, links Claude has noted
```

`Claude/profile.md` and `Claude/active-projects.md` are written and maintained by Milan in Obsidian — intentional inputs, never written by Claude. The `Claude/memory/` files mirror Claude Code's local memory system and are surfaced in Obsidian via sync.

## Component 1: Sync Script

**File:** `scripts/sync-brain.sh`

**Behavior:**
- Bidirectional rsync with `--update` flag (last-modified-wins, no deletions)
- `local-to-vault` direction: copies `LOCAL_MEMORY/` → `$VAULT_PATH/Claude/memory/`
- `vault-to-local` direction: copies `$VAULT_PATH/Claude/memory/` → `LOCAL_MEMORY/`
- Creates `$VAULT_PATH/Claude/memory/` if it does not exist
- The script accepts a direction argument: `sync-brain.sh local-to-vault` or `sync-brain.sh vault-to-local`

**Path derivation:**

The `LOCAL_MEMORY` path encodes the project's absolute path as a slug (Claude Code convention: replace `/` with `-`). This is machine-specific. The script derives it dynamically from the repo root:

```bash
REPO_ROOT=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
PROJECT_SLUG=$(echo "$REPO_ROOT" | sed 's|^/||; s|/|-|g')
LOCAL_MEMORY="$HOME/.claude/projects/$PROJECT_SLUG/memory"
VAULT_MEMORY="${VAULT_PATH}/Claude/memory"
```

`VAULT_PATH` must be set as an environment variable (it is set in `web/.env.local`; the script sources it from there if not already in the environment).

**iCloud sync latency:** the vault is stored inside an iCloud-managed directory. When running `vault-to-local` at session start, iCloud may not have synced the latest Obsidian edits yet. The `--update` flag will correctly skip files where local is newer, but cannot detect iCloud-pending edits. This is an accepted limitation — if the vault appears stale, wait for iCloud to sync and re-run the script.

**Claude Code hook:**

In `~/.claude/settings.json`, add a `PostToolUse` hook on the `Write` tool. The hook always fires on any write, so the script itself checks whether the written file is inside `LOCAL_MEMORY` before running rsync:

```bash
if [[ "$1" == "local-to-vault" ]]; then
  # Called from hook with the written file path as $2
  if [[ "$2" != "$LOCAL_MEMORY"* ]]; then
    exit 0  # not a memory write, skip
  fi
  rsync -av --update "$LOCAL_MEMORY/" "$VAULT_MEMORY/"
fi
```

The hook in `~/.claude/settings.json`:
```json
"hooks": {
  "PostToolUse": [{
    "matcher": "Write",
    "hooks": [{
      "type": "command",
      "command": "bash /path/to/scripts/sync-brain.sh local-to-vault \"${TOOL_INPUT_PATH}\""
    }]
  }]
}
```

**Session-start trigger:**

In the root `CLAUDE.md` (not `web/CLAUDE.md` — Claude Code reads from the project root during session initialization), add:

```markdown
## Memory sync
At the start of each session, run: `bash scripts/sync-brain.sh vault-to-local`
This pulls any changes made in Obsidian into local memory.
```

## Component 2: `get_context` MCP Tool

**Location:** `web/app/api/mcp/route.ts` (added alongside existing tools)

**Signature:**
```
get_context(topic?: string) → text
```

**Implementation approach:**

For the base reads (the `Claude/` files), use `getVaultClient().readFile()` directly — do NOT call `loadNotes()`, which loads the entire vault. Only load the full note index when `topic` is supplied.

The existing `search_notes` tool logic lives inside an anonymous callback and cannot be called directly. Extract it into a shared helper before implementing `get_context`:

```typescript
function searchNoteMap(
  noteMap: Map<string, { path: string; title: string; type: string; tags: string[]; content: string }>,
  query: string
) {
  const lower = query.toLowerCase()
  return Array.from(noteMap.values())
    .filter(n => n.title.toLowerCase().includes(lower) || n.content.toLowerCase().includes(lower))
    .slice(0, 10)
    .map(n => ({ path: n.path, title: n.title, type: n.type }))
}
```

Both `search_notes` and `get_context` (when topic is given) call this helper.

**Behavior:**

1. Call `getVaultClient()`. If this throws (vault not configured), catch it and return an empty context string — do not propagate the error.
2. For each of the six `Claude/` files, attempt `client.readFile(path)`. Missing files are silently skipped (catch per file).
3. If `topic` is provided: call `loadNotes()` and `searchNoteMap(noteMap, topic)` to find relevant notes. Append results.
4. Concatenate all content and return as structured text.

**Return format:**

```
## Profile
<content of Claude/profile.md, or "(not set up yet)">

## Active Projects
<content of Claude/active-projects.md, or "(not set up yet)">

## Memory: User
<content of Claude/memory/user.md, or "(empty)">

## Memory: Feedback
<content of Claude/memory/feedback.md, or "(empty)">

## Memory: Projects
<content of Claude/memory/project.md, or "(empty)">

## Memory: References
<content of Claude/memory/reference.md, or "(empty)">

## Related Notes (topic: "<topic>")   ← only present when topic is supplied
- path/to/note.md — Note Title
...
```

If the vault is not configured and all reads fail, return: `"(No personal context configured. Create Claude/profile.md in your vault to get started.)"`

## New Files

| File | Action | Purpose |
|---|---|---|
| `scripts/sync-brain.sh` | Create | Bidirectional memory sync |
| `web/app/api/mcp/route.ts` | Modify | Extract `searchNoteMap` helper, add `get_context` tool |
| `~/.claude/settings.json` | Modify | Add PostToolUse hook for sync |
| `CLAUDE.md` (root) | Modify | Add session-start sync instruction |

## Vault Bootstrap

`Claude/profile.md` and `Claude/active-projects.md` are created manually by Milan in Obsidian before using the system. The sync script creates `Claude/memory/` on first run. Until the bootstrap notes exist, `get_context` returns the graceful placeholder strings above.

## Out of Scope

- Conflict resolution beyond last-modified-wins
- Syncing Claude Code memories from other projects
- Automatic creation of `profile.md` or `active-projects.md`
- `write_memory` MCP tool (local memory + sync covers this)
- GitHub vault variant for `get_context` (only `VAULT_PATH` / `LocalVaultClient` is addressed; remote vault would require the Vercel function to have different access)

## Security Notes

- `get_context` is protected by the same JWT auth as all other MCP tools — only authenticated Claude Cowork sessions can read personal context
- `sync-brain.sh` runs locally only, never touches the network
- The `Claude/` vault folder is part of the git-tracked vault repo (`superbrain-vault`) — treat it as semi-private (same as all vault notes)
