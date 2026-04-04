# Mai Superbrain — Brain App Design

**Date:** 2026-04-04
**Status:** Approved

---

## Overview

A personal brain management system for Milan van Bruggen, built around an Obsidian vault stored in a GitHub repository. The system consists of three integrated components: a GitHub-hosted vault as the single source of truth, a Next.js PWA deployed on Vercel for visual brain management, and a local MCP server that gives Claude Code direct access to the vault.

The primary use case is browsing and editing a personal knowledge graph — not running agents. The brain acts as an extended memory layer that AI tools (Claude Code, etc.) can read from and write to.

Assumed vault size: ~200–500 notes initially, expected to grow to ~1,000.

---

## Architecture

```
GitHub repo (Obsidian vault)
       ↕ git push/pull        ↕ GitHub API (read/write via PAT)
Local clone                   Vercel Next.js PWA
  ↕ filesystem                  ↕ (hosted, phone-accessible)
Obsidian app    Local MCP server (for Claude Code)
```

### Data flow

1. GitHub repo is the canonical vault — markdown files with `[[wikilinks]]`
2. The webapp reads and writes via GitHub API using a PAT; each write becomes a commit
3. Obsidian works on the local clone; sync via git pull/push or the Obsidian Git plugin
4. The local MCP server reads vault files from the filesystem; Claude Code uses this as context

---

## Components

### 1. GitHub Vault (Source of Truth)

- Markdown files with `[[wikilinks]]` as graph edges
- YAML frontmatter for structured metadata: `tags`, `type`, `date`
- Optional typed `relations` frontmatter (see Vault Schema)
- Folder structure per domain (e.g. `people/`, `projects/`, `ideas/`, `notes/`)
- No proprietary format — plain markdown, fully portable

### 2. Next.js PWA (Vercel)

**Stack:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, React Force Graph, CodeMirror 6, FlexSearch

**Features:**

- **Graph view** — interactive canvas using React Force Graph; nodes are markdown files, edges are wikilinks (untyped) and typed relations
- **Detail panel** — clicking a node shows: rendered markdown content, frontmatter metadata, incoming and outgoing links
- **Edit mode** — CodeMirror 6 editor (optimised for mobile); saving creates a GitHub API commit
- **Full-text search** — client-side FlexSearch index built from the cached graph snapshot
- **Auth** — GitHub OAuth via NextAuth.js (single user; only Milan can authenticate)
- **PWA** — installable on iPhone; service worker caches the last full vault snapshot for read-only offline access; offline editing is out of scope

**Graph construction strategy:**

A Next.js Route Handler (`/api/vault/graph`) fetches the full recursive tree from GitHub once using `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`, then fetches each markdown file's content, parses wikilinks and frontmatter, and returns a graph JSON object `{ nodes, edges }`. The result is cached in-memory on the server with a 5-minute TTL. The client receives the full graph on load. Individual file reads for the detail panel hit GitHub API directly (small, infrequent).

This keeps the client simple and stays well within the 5,000 req/hour authenticated GitHub API limit for the expected vault size.

**GitHub API credentials:**

All GitHub API calls (reads and writes) use a single Personal Access Token (PAT) stored as a Vercel environment variable (`GITHUB_PAT`). All commits appear under Milan's account because it is his PAT. No per-session OAuth token is used for API access; NextAuth.js is used only for authentication (confirming the user is Milan before serving the app).

**Commit message convention:**

```
brain: update [[Note Title]]
brain: create [[Note Title]]
brain: delete [[Note Title]]
```

This makes webapp commits distinguishable from Obsidian commits in the git log.

**Wikilink resolution:**

Wikilinks are resolved case-insensitively by filename stem across all folders. `[[Milan van Bruggen]]` matches `people/Milan van Bruggen.md`. First match wins when multiple files share the same stem. Duplicate stems are flagged visually in the graph (dashed edge or warning indicator on the node). This matches Obsidian's default resolution behaviour.

### 3. Local MCP Server

**Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk`

**Tools exposed to Claude Code:**

| Tool | Description |
|------|-------------|
| `search_notes` | Full-text search across vault markdown files |
| `read_note` | Read a single note by path or title |
| `write_note` | Create or update a note |
| `get_related` | Get all notes linked to a given note (in + out) |
| `list_notes` | List notes, optionally filtered by folder or tag |

**Configuration:**

The MCP server resolves the vault path from the `VAULT_PATH` environment variable (e.g. `VAULT_PATH=/Users/milan/vault`). It is registered in Claude Code's MCP settings at `~/.claude/mcp_settings.json`:

```json
{
  "mcpServers": {
    "superbrain": {
      "command": "node",
      "args": ["/path/to/mai-superbrain/mcp/dist/index.js"],
      "env": {
        "VAULT_PATH": "/Users/milan/vault"
      }
    }
  }
}
```

The server is started automatically by Claude Code when needed.

**How it works:**

- Reads markdown files directly from the local clone of the vault
- Parses `[[wikilinks]]` to build a relationship graph in memory on startup
- Wikilink resolution follows the same logic as the webapp (case-insensitive stem match)

---

## Vault Schema

Each note follows this frontmatter convention:

```yaml
---
title: Note Title
type: person | project | idea | note | resource
tags: [tag1, tag2]
date: 2026-04-04
relations:
  - target: "[[Other Note]]"
    type: works_with | part_of | inspired_by | references
---
```

**Edge types and precedence:**

- Plain `[[wikilinks]]` in the note body create **untyped edges**
- `relations` frontmatter entries create **typed edges**
- Both are additive — both contribute edges to the graph
- If a `relations` entry targets a note that is also linked via a body wikilink, the typed edge is shown in the graph and the untyped edge is suppressed (to avoid visual duplication)
- In the graph view, typed edges are rendered with a label; untyped edges are plain lines

---

## Sync Strategy

- **Obsidian ↔ GitHub:** Obsidian Git plugin (auto-commit + pull on vault open/close) or manual `git push`
- **Webapp ↔ GitHub:** Direct via GitHub API — no git needed in the browser
- **MCP server ↔ GitHub:** Reads local clone; user runs `git pull` to get latest changes from webapp edits
- **Conflict resolution:** Last write wins. The user is responsible for resolving conflicts via standard git when they occur (e.g. after editing in the webapp and Obsidian without syncing in between). No automatic conflict resolution is implemented.

---

## Auth & Access

- GitHub OAuth via NextAuth.js — only Milan's GitHub account can log in
- GitHub PAT stored as Vercel env var `GITHUB_PAT` — used for all GitHub API calls
- MCP server: no auth (local only, runs as the user's local process)

---

## Out of Scope

- Agent runtime / Docker containers (separate system)
- Email drafting / morning briefings (separate system)
- Multi-user access
- Real-time collaboration
- Offline editing (read-only offline cache is in scope; writes require connectivity)
- Automatic conflict resolution (user resolves via git when needed)
