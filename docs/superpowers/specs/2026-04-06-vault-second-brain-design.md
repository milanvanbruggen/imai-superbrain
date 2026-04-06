# Vault as Second Brain Design

## Goal

Extend the Superbrain system so that Claude Code's persistent memory is visible and editable in Obsidian, and Claude Cowork can dynamically retrieve personal context from the vault. The vault becomes the single source of truth for personal/cross-project context.

## Context

The Superbrain project has an MCP server at `/api/mcp` (deployed on Vercel) with five tools: `list_notes`, `search_notes`, `read_note`, `write_note`, `get_related`. Claude Code (CLI) has its own local memory system at `~/.claude/projects/.../memory/`. These two systems currently don't communicate.

The vault lives at `/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain` (local) and is also accessible via GitHub (`GITHUB_VAULT_REPO=superbrain-vault`). Local vault takes priority when `VAULT_PATH` is set.

## Architecture

Two independent components that work together:

**Component 1 — Sync script**: bidirectional rsync between Claude Code's local memory directory and `Claude/memory/` in the vault. Last-modified-wins. Triggered automatically after Claude Code memory writes via a Claude Code `PostToolUse` hook, and run at session start (vault → local direction) via a CLAUDE.md instruction.

**Component 2 — MCP context tool**: a new `get_context(topic?)` tool in the existing MCP server. Reads the vault's `Claude/` section and returns relevant context as text. Used by Claude Cowork to load personal context at the start of a conversation.

These two components are independent — the sync script requires no server changes, and the MCP tool works regardless of whether the sync script is active.

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

`Claude/profile.md` and `Claude/active-projects.md` are written and maintained by Milan in Obsidian — they are intentional inputs, not written by Claude. The `Claude/memory/` files are written by Claude via the local memory system and surfaced in Obsidian via sync.

## Component 1: Sync Script

**File:** `scripts/sync-brain.sh`

**Behavior:**
- Bidirectional rsync with `--update` flag (last-modified-wins, no deletions)
- Direction 1 (local → vault): runs after Claude Code writes a memory file
- Direction 2 (vault → local): runs at Claude Code session start to pick up Obsidian edits
- Creates `Claude/memory/` in the vault if it does not exist
- No conflict resolution beyond last-modified-wins — conflicts are rare since Claude writes frequently and the user edits occasionally

**Variables:**
```
LOCAL_MEMORY=~/.claude/projects/-Users-milanvanbruggen-Web-mai-superbrain/memory
VAULT=$VAULT_PATH/Claude/memory  # where VAULT_PATH is the Obsidian vault root
```

**Trigger — Claude Code hook:**

In `~/.claude/settings.json`, add a `PostToolUse` hook on the `Write` tool that runs `sync-brain.sh local-to-vault` whenever Claude writes a file inside the memory directory.

**Trigger — session start:**

In `web/CLAUDE.md` (or root `CLAUDE.md`), add an instruction: "At the start of each session, run `scripts/sync-brain.sh vault-to-local` to pull in any changes made in Obsidian."

## Component 2: `get_context` MCP Tool

**Location:** `web/app/api/mcp/route.ts` (added alongside existing tools)

**Signature:**
```
get_context(topic?: string) → text
```

**Behavior:**

1. Always reads: `Claude/profile.md`, `Claude/active-projects.md`, and all files in `Claude/memory/` (user.md, feedback.md, project.md, reference.md). Missing files are silently skipped.
2. If `topic` is provided: also calls the existing `search_notes` logic to find relevant vault notes matching the topic.
3. Returns all content concatenated as a single text block with section headers.

**Usage:** Claude Cowork calls `get_context(topic)` at the start of a conversation, or when it needs personal context to answer a question. This replaces manually prompting "who am I" every session.

**Error handling:** if no `Claude/` files exist yet, returns an empty string with a note that no context has been set up. Does not throw.

## New Files

| File | Action | Purpose |
|---|---|---|
| `scripts/sync-brain.sh` | Create | Bidirectional memory sync |
| `web/app/api/mcp/route.ts` | Modify | Add `get_context` tool |
| `~/.claude/settings.json` | Modify | Add PostToolUse hook for sync |
| `web/CLAUDE.md` | Modify | Add session-start sync instruction |

## Vault Bootstrap

Before the system is useful, `Claude/profile.md` and `Claude/active-projects.md` need to exist. These are created manually by Milan in Obsidian — no code creates them. A `Claude/memory/` folder with empty placeholder files is created by the sync script on first run.

## Out of Scope

- Conflict resolution beyond last-modified-wins
- Syncing Claude Code memories from other projects
- Automatic creation of `profile.md` or `active-projects.md`
- `write_memory` MCP tool (not needed — local memory + sync covers this)
- Vault → Vercel sync (GitHub vault variant not addressed; `get_context` works with local vault only via `VAULT_PATH`)

## Security Notes

- `get_context` is protected by the same JWT auth as all other MCP tools — only authenticated Claude Cowork sessions can read personal context
- `sync-brain.sh` runs locally only, never touches the network
- The `Claude/` vault folder is part of the git-tracked vault repo (`superbrain-vault`) — treat it as semi-private (same as all vault notes)
