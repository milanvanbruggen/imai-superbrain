# Visual Relation Editor — Design

**Date:** 2026-04-08  
**Status:** Approved

## Problem

Adding links between notes or changing a note's type requires manually editing the markdown file (frontmatter or body). Users cannot do this through the UI without touching the raw text.

## Goal

Allow users to change a note's type and add/remove links to other notes directly from the DetailPanel sidebar, without opening the editor. Changes must work in both Superbrain (graph) and Obsidian (native link detection).

## Obsidian Compatibility

Obsidian detects `[[wikilinks]]` in body text, including inside HTML comments. The app manages a dedicated block at the end of each file:

```
<!-- superbrain:related -->
[[Note1]] [[Note2]]
<!-- /superbrain:related -->
```

This block is invisible in Obsidian's reading view but active as links in the graph. Superbrain parses it separately so it can distinguish UI-managed links from organic body wikilinks.

**For typed relations:** stored in both frontmatter `relations` (for Superbrain's typed edge) and the managed body block (for Obsidian). Superbrain already suppresses duplicate untyped edges when a typed edge covers the same pair.

**For untyped links:** stored only in the managed body block.

## Data Model

### `VaultNote` (`web/lib/types.ts`)

Add `managedLinks: string[]` — stems extracted from the `<!-- superbrain:related -->` block.

```ts
export interface VaultNote {
  // existing fields...
  managedLinks: string[]  // stems from the superbrain:related block
}
```

### Body block format

```
<!-- superbrain:related -->
[[Stem1]] [[Stem2]] [[Stem3]]
<!-- /superbrain:related -->
```

- One line of `[[stem]]` entries inside the comment block
- Block is created when the first UI link is added
- Block is removed when the last UI link is removed
- Typed relations that also appear in frontmatter are included here too (for Obsidian)

## Architecture

### 1. Parser (`web/lib/vault-parser.ts`)

Add three helpers (not exported — internal only):

**`extractManagedBlock(content: string): string[]`**  
Returns stems from the `<!-- superbrain:related -->` block. Returns `[]` if block absent.

**`addToManagedBlock(content: string, stem: string): string`**  
Adds `[[stem]]` to the block (creates block at end if absent). No-op if already present.

**`removeFromManagedBlock(content: string, stem: string): string`**  
Removes `[[stem]]` from the block. Removes the entire block if it becomes empty.

`parseNote` calls `extractManagedBlock` and sets `managedLinks` on the returned `VaultNote`.

### 2. API (`web/app/api/vault/note/[...path]/route.ts`)

Extend `PATCH` to support three new operations alongside the existing `title` rename:

**`set-type`**
```json
{ "operation": "set-type", "type": "project" }
```
Reads file → sets `data.type` in frontmatter → writes back. Body untouched.

**`add-relation`**
```json
{ "operation": "add-relation", "target": "Superbrain", "relationType": "works_with" }
```
- If `relationType` is non-null: adds `{ target: "[[Superbrain]]", type: "works_with" }` to `data.relations` in frontmatter
- Always: adds `[[Superbrain]]` to the managed body block  
- Writes file back. Invalidates cache.

**`remove-relation`**
```json
{ "operation": "remove-relation", "target": "Superbrain" }
```
- Removes matching entry from `data.relations` (if present)
- Removes `[[Superbrain]]` from managed body block (if present)
- Writes file back. Invalidates cache.

### 3. DetailPanel (`web/components/DetailPanel.tsx`)

New props:
```ts
noteTypes: { name: string; color: string }[]  // for type picker
typeColors: Record<string, string>             // hex colors by type name
```

**Type badge → inline type picker**

The type badge in the header becomes a button. On click, an inline grid of type pills opens below it (one pill per configured type). Selecting a type calls `PATCH set-type`, then `onNoteUpdated()`. The grid closes after selection.

**Links section changes**

Each link row in "Links to" (both `note.relations` and `note.managedLinks`) gets a `×` button:
- For relations (typed): calls `PATCH remove-relation` with the target stem
- For managed links (untyped): calls `PATCH remove-relation` (which handles frontmatter + block)

Organic body wikilinks (`note.wikilinks` minus `note.managedLinks` minus relation targets) are shown read-only — no `×` button, with a small indicator that they're in-text links.

**Inline link picker**

"+ Toevoegen" button below the links list toggles an inline picker panel:

1. Type tabs across the top (one per available type from `allNodes`)
2. List of notes of the selected type (from `allNodes`, excluding current note and already-linked notes)
3. Dropdown: relation type (`— geen —`, `works_with`, `part_of`, `inspired_by`, `references`)
4. "Toevoegen" button → calls `PATCH add-relation` → `onNoteUpdated()` → picker closes

### 4. `page.tsx`

Pass `noteTypes` and `typeColors` as new props to `DetailPanel`.

## Files Changed

| File | Change |
|---|---|
| `web/lib/types.ts` | Add `managedLinks: string[]` to `VaultNote` |
| `web/lib/vault-parser.ts` | Add managed block helpers; set `managedLinks` in `parseNote` |
| `web/app/api/vault/note/[...path]/route.ts` | Extend PATCH with `set-type`, `add-relation`, `remove-relation` |
| `web/components/DetailPanel.tsx` | Type badge picker, link add/remove UI, new props |
| `web/app/page.tsx` | Pass `noteTypes` and `typeColors` to DetailPanel |

## Relation Types

Hardcoded set (existing values already in use):
- `works_with`
- `part_of`
- `inspired_by`
- `references`
