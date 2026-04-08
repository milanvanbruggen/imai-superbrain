# MCP Token Efficiency & Navigation — Design

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Three targeted improvements to the local MCP server, inspired by LinkedIn feedback from engineers who have experimented with similar knowledge-graph + LLM setups:

1. **A2 — `read_note` default content limit** — prevents silent context window bloat
2. **B1 — `get_context(query)` tool** — replaces the search → read → get_related chain with a single smart call
3. **C2 — `get_index()` tool** — gives Claude a machine-readable map of the entire vault in one call

All changes are purely in `mcp/src/`. No external dependencies added.

**Note on A2 backwards compatibility:** Adding a default truncation to `read_note` is a conscious behaviour change. Any caller that relied on receiving full content without passing `full: true` will now receive truncated content. This is intentional — the new default is the safer option.

---

## Changes

### A2: `read_note` — default content truncation

**Problem:** `read_note` always returns full note content. Large notes or repeated calls silently consume the context window (Jeroen Rinzema's observation).

**Change:** Add optional `full` boolean to the input schema.

- `full: false` (default): content is truncated at **2,000 UTF-16 code units** (JavaScript `string.length`). Truncation snaps to the nearest newline at or before the 2,000-char boundary; if no newline exists before that point, it hard-cuts at exactly 2,000 chars. Response includes `truncated: true`.
- `full: true`: full content returned, no truncation. `truncated` field is absent from the response.
- If the note content is shorter than 2,000 chars, no truncation occurs and `truncated` is absent.

**Input schema addition:**
```
full?: boolean   — return full content without truncation (default: false)
```

**Response:**
```
path: string
title: string
type: string
tags: string[]
content: string       — note content (possibly truncated)
truncated?: boolean   — present and true only when content was cut; absent otherwise
```

---

### B1: New tool `get_context(query)`

**Problem:** Getting useful context currently requires: `search_notes` → multiple `read_note` calls → optional `get_related`. This is slow and token-heavy (Vincent van Deth's observation).

**Change:** A new tool that does search + excerpt + outgoing links in one call.

**Input schema:**
```
query: string      — search term (required); matched case-insensitively
limit?: number     — max results (default: 5; silently clamped to 10)
```

**Matching behaviour:** Same as `search_notes` — both `title` and `content` are lowercased before matching. A note matches if the lowercased query appears in either.

**Excerpt construction:**
- If the query appears in `content`: find the first occurrence (case-insensitive). Extract 100 chars before and 100 chars after the match centre (200 chars total). Prepend `...` only if the excerpt start is not at position 0. Append `...` only if the excerpt end does not reach the end of content.
- If the query appears only in `title` (not in `content`): use the first 200 chars of `content` as the excerpt, with a trailing `...` if content is longer than 200 chars.
- If `content` is empty: excerpt is an empty string.

**Response per result:**
```
path: string
title: string
type: string
tags: string[]
excerpt: string    — ~200 chars surrounding the match (see above)
links: string[]    — raw wikilink stems from ParsedNote.wikilinks (e.g. ["Milan van Bruggen", "Project X"])
```

**Note on `links` field:** These are the raw wikilink texts extracted from `[[...]]` syntax, as stored in `ParsedNote.wikilinks` — not resolved paths. This is deliberate: the field is for orientation (what does this note reference?) not for navigation (use `get_related` or `read_note` for resolved paths).

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
  link_count: number   — number of outgoing wikilinks (= links.length)
  links: string[]      — raw wikilink stems (same source as get_context: ParsedNote.wikilinks)
}
```

No content, no excerpts. Claude can identify hub notes (high `link_count`), explore by type or tag, and plan targeted reads — all without a single `read_note` call.

**Known size trade-off:** For a vault of ≤1,000 notes, the response is acceptably compact (stems are short strings). This is the expected vault size per the original design doc. If the vault grows significantly beyond that, response size may need to be revisited.

---

## Naming consistency

Both `get_context` and `get_index` use `links: string[]` to refer to raw outgoing wikilink stems from `ParsedNote.wikilinks`. This is consistent across both tools.

---

## File changes

| File | Change |
|------|--------|
| `mcp/src/tools/read-note.ts` | Add `full` param, truncation logic, `truncated` flag |
| `mcp/src/tools/get-context.ts` | New file |
| `mcp/src/tools/get-index.ts` | New file |
| `mcp/src/index.ts` | Register two new tools in the `tools` array |

---

## Out of scope

- Changes to the web app (`web/`)
- Changes to vault schema or frontmatter conventions
- Semantic/embedding-based search (full-text is sufficient for this vault size)
- Caching of `get_index()` results (vault is loaded in memory on startup; no extra cost)
