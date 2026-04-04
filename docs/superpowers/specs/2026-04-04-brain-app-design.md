# Mai Superbrain — Brain App Design

**Date:** 2026-04-04
**Status:** Approved

---

## Overview

A personal brain management system for Milan van Bruggen, built around an Obsidian vault stored in a GitHub repository. The system consists of three integrated components: a GitHub-hosted vault as the single source of truth, a Next.js PWA deployed on Vercel for visual brain management, and a local MCP server that gives Claude Code direct access to the vault.

The primary use case is browsing and editing a personal knowledge graph — not running agents. The brain acts as an extended memory layer that AI tools (Claude Code, etc.) can read from and write to.

---

## Architecture

```
GitHub repo (Obsidian vault)
       ↕ git push/pull        ↕ GitHub API (read/write)
Local clone                   Vercel Next.js PWA
  ↕ filesystem                  ↕ (hosted, phone-accessible)
Obsidian app    Local MCP server (for Claude Code)
```

### Data flow

1. GitHub repo is the canonical vault — markdown files with `[[wikilinks]]`
2. The webapp reads and writes via GitHub API; each write becomes a commit
3. Obsidian works on the local clone; sync via `git pull/push` or the Obsidian Git plugin
4. The local MCP server reads vault files from the filesystem; Claude Code uses this as context

---

## Components

### 1. GitHub Vault (Source of Truth)

- Markdown files with `[[wikilinks]]` as graph edges
- YAML frontmatter for structured metadata: `tags`, `type`, `date`, `relation_type`
- Folder structure per domain (e.g. `people/`, `projects/`, `ideas/`, `notes/`)
- No proprietary format — plain markdown, fully portable

### 2. Next.js PWA (Vercel)

**Stack:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui

**Features:**

- **Graph view** — interactive canvas using React Force Graph; nodes are markdown files, edges are `[[wikilinks]]`
- **Detail panel** — clicking a node shows: markdown content, frontmatter metadata, and outgoing/incoming links
- **Edit mode** — inline markdown editor in the webapp; saving creates a GitHub API commit
- **Full-text search** — search across all vault notes
- **Auth** — GitHub OAuth (single user; only Milan can access)
- **PWA** — installable on iPhone, works offline for reading cached notes

**GitHub API usage:**
- Read: `GET /repos/{owner}/{repo}/contents/{path}` for file listing and content
- Write: `PUT /repos/{owner}/{repo}/contents/{path}` with commit message
- Tree: `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` for full vault index

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

**How it works:**
- Reads markdown files directly from the local clone of the vault
- Parses `[[wikilinks]]` to build relationship graph in memory
- Runs as a local process when Claude Code needs context

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

The `relations` frontmatter is optional but enables typed edges in the graph beyond plain wikilinks.

---

## Sync Strategy

- **Obsidian ↔ GitHub:** Obsidian Git plugin (auto-commit + pull on open/close) or manual `git push`
- **Webapp ↔ GitHub:** Direct via GitHub API — no git needed in the browser
- **MCP server ↔ GitHub:** Reads local clone; user runs `git pull` to get latest from webapp edits

---

## Auth & Access

- GitHub OAuth via NextAuth.js
- Only Milan's GitHub account can authenticate
- GitHub personal access token (stored as Vercel env var) for API read/write to the vault repo
- MCP server: no auth (local only)

---

## Out of Scope

- Agent runtime / Docker containers (separate system)
- Email drafting / morning briefings (separate system)
- Multi-user access
- Real-time collaboration
- Conflict resolution (vault is single-user, conflicts are unlikely)
