# MCP Token Efficiency & Navigation — Design

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Three targeted improvements to the local MCP server, inspired by LinkedIn feedback from engineers who have experimented with similar knowledge-graph + LLM setups:

1. **A2 — `read_note` default content limit** — prevents silent context window bloat
2. **B1 — `get_context(query)` tool** — replaces the search → read → get_related chain with a single smart call
3. **C2 — `get_index()` tool** — gives Claude a machine-readable map of the entire vault in one call

All changes are purely in `mcp/src/`. No external dependencies added. Backwards compatible where possible.

---

## Changes

### A2: `read_note` — default content truncation

**Problem:** `read_note` always returns full note content. Large notes or repeated calls silently consume the context window (Jeroen Rinzema's observation).

**Change:** Add optional `full` boolean to the input schema (default: `false`).

- `full: false` (default): content is truncated at **2,000 characters**; response includes `truncated: true`
- `full: true`: full content returned, no truncation

Existing callers that omit `full` automatically get the safer truncated version. Claude can always request the full note explicitly when needed.

**Input schema addition:**
```
full?: boolean   — return full content (default: false, truncates at 2000 chars)
```

**Response change:**
```
content: string       — note content (possibly truncated)
truncated?: boolean   — present and true when content was cut
```

---

### B1: New tool `get_context(query)`

**Problem:** Getting useful context currently requires: `search_notes` → multiple `read_note` calls → optional `get_related`. This is slow and token-heavy (Vincent van Deth's observation).

**Change:** A new tool that does search + excerpt + outgoing links in one call.

**Input schema:**
```
query: string      — search term (required)
limit?: number     — max results to return (default: 5, max: 10)
```

**Response per result:**
```
path: string
title: string
type: string
tags: string[]
excerpt: string        — ~200 chars surrounding the match, bounded by "..."
outgoing_links: string[]  — stems of wikilinks found in this note
```

**Implementation:** Reuses the full-text search logic from `search_notes`. For each match, finds the character position of the query in the content and extracts 100 chars before and after, trimmed to word boundaries and prefixed/suffixed with `...` where content is cut. Results are capped at `limit` (default 5).

---

### C2: New tool `get_index()`

**Problem:** Claude has no way to survey the whole vault structure without many tool calls. This makes initial orientation expensive (Rudy Henk Jellesma / Karpathy's LLM Wiki observation).

**Change:** A new no-input tool that returns a compact structural map of the entire vault.

**Input schema:** none

**Response:**
```
notes: Array of {
  path: string
  title: string
  type: string
  tags: string[]
  link_count: number     — number of outgoing wikilinks
  links: string[]        — stems of outgoing wikilinks
}
```

No content, no excerpts. Claude can identify hub notes (high `link_count`), explore by type or tag, and plan targeted reads — all without a single `read_note` call.

---

## File changes

| File | Change |
|------|--------|
| `mcp/src/tools/read-note.ts` | Add `full` param, truncation logic, `truncated` flag |
| `mcp/src/tools/get-context.ts` | New file |
| `mcp/src/tools/get-index.ts` | New file |
| `mcp/src/index.ts` | Register two new tools |

---

## Out of scope

- Changes to the web app (`web/`)
- Changes to vault schema or frontmatter conventions
- Semantic/embedding-based search (full-text is sufficient for this vault size)
- Caching of `get_index()` results (vault is loaded in memory on startup; no extra cost)
