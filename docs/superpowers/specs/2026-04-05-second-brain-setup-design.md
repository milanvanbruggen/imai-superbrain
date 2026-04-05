---
name: Second Brain Setup
description: Complete second brain setup — CLAUDE.md identity file, PARA-based vault structure, new note types, and minimal app improvements
type: spec
date: 2026-04-05
status: approved
---

# Second Brain Setup — Design Spec

## Overview

Upgrade Mai Superbrain from a knowledge graph viewer into a fully operational second brain that Claude Code (and claude.ai) can use as a central knowledge input. The system has three layers:

1. **`CLAUDE.md` identity file** — persistent context for Claude about who Milan is
2. **Vault structure** — PARA-based folder conventions + extended note types
3. **App improvements** — template-based note creation, new graph node types, inbox badge

No AI API integration is in scope. Claude is used via the existing MCP server (Claude Code) or externally via claude.ai.

---

## Layer 1: CLAUDE.md Identity File

**Location:** `<vault-root>/CLAUDE.md`

Claude Code automatically reads `CLAUDE.md` at session start. This file gives Claude persistent context about Milan without requiring re-explanation each session.

### Template structure

```markdown
# Milan van Bruggen — Second Brain

## Identiteit
<!-- Wie ben je, je rol, expertise, achtergrond -->

## Werkwijze
<!-- Hoe je denkt en werkt, beslissingsstijl, voorkeuren -->

## Schrijfstijl
<!-- Taal (NL/EN per context), toon, structuurvoorkeur -->

## Huidige projecten
<!-- Lijst van actieve projecten met 1-2 zinnen context elk -->

## Vault structuur
<!-- Korte uitleg van de folder structuur zodat Claude weet waar wat staat -->

## Instructies voor Claude
<!-- Wat Claude wel/niet moet doen, hoe notities aangemaakt moeten worden, etc. -->
```

**Deliverable:** A blank `CLAUDE.md` template committed to the vault root. In local dev this is `$VAULT_PATH/CLAUDE.md`; in production it lives in the GitHub vault repo (`GITHUB_VAULT_OWNER/GITHUB_VAULT_REPO`). Milan fills in the content.

---

## Layer 2: Vault Structure

### Folder layout (PARA-inspired)

```
vault/
├── CLAUDE.md                    # Identity file
├── people/                      # type: person
├── projects/                    # type: project (actieve projecten)
├── areas/                       # type: area (verantwoordelijkheden zonder deadline)
├── ideas/                       # type: idea
├── resources/                   # type: resource (referentiemateriaal)
├── meetings/                    # type: meeting (vergadernotities)
├── daily/                       # type: daily (dagelijkse log/reflectie)
└── inbox/                       # Ongesorteerde quick captures
```

### Inbox principle
Everything goes to `inbox/` first — capture without thinking about structure. Claude (via MCP) can help process the inbox periodically into the right folders.

### Note type templates (frontmatter)

**person**
```yaml
---
title: ""
type: person
tags: []
relations: []
---
```

**project**
```yaml
---
title: ""
type: project
date: YYYY-MM-DD
tags: []
status: active
relations: []
---

## Doel

## Voortgang

## Open punten
```

**area**
```yaml
---
title: ""
type: area
tags: []
relations: []
---

## Beschrijving

## Standaard en doelen
```

**idea**
```yaml
---
title: ""
type: idea
date: YYYY-MM-DD
tags: []
relations: []
---
```

**resource**
```yaml
---
title: ""
type: resource
tags: []
source: ""
relations: []
---
```

**meeting**
```yaml
---
title: ""
type: meeting
date: YYYY-MM-DD
tags: []
attendees: []
relations: []
---

## Agenda

## Notities

## Actiepunten
```

**daily**
```yaml
---
title: YYYY-MM-DD
type: daily
date: YYYY-MM-DD
tags: []
---

## Focus vandaag

## Log

## Reflectie
```

**inbox (no template)**
Plain markdown file, no frontmatter required. Just capture.

---

## Layer 3: App Improvements

### 3.1 Extended note types

**`web/lib/types.ts`** — extend `VaultNote['type']`:

```typescript
type: 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area'
```

**`web/components/BrainGraph.tsx`** — add colors for new types:

| Type | Color |
|------|-------|
| `meeting` | `#EAB308` (yellow) |
| `daily` | `#6B7280` (gray) |
| `area` | `#EC4899` (pink) |

**`web/lib/vault-parser.ts`** — update the `VALID_TYPES` constant to include all 8 types:

```typescript
const VALID_TYPES = ['person', 'project', 'idea', 'note', 'resource', 'meeting', 'daily', 'area']
```

This is critical: without this change, notes with `type: meeting/daily/area` in frontmatter are silently coerced to `type: 'note'` and rendered with the wrong graph color.

### 3.2 Template-based new note creation

**New component: `NewNoteModal.tsx`**

A modal triggered by a `+ New Note` button in the main UI. Fields:
- Title (text input)
- Type (select: all 8 types)
- Folder (auto-suggested based on type, editable)

**Type-to-folder mapping** (auto-suggested, user can override):

| Type | Default folder |
|------|---------------|
| `person` | `people/` |
| `project` | `projects/` |
| `meeting` | `meetings/` |
| `daily` | `daily/` |
| `idea` | `ideas/` |
| `resource` | `resources/` |
| `area` | `areas/` |
| `note` | `inbox/` |

**Daily note filename:** For `type: daily`, the filename is derived from the date (e.g., `daily/2026-04-05.md`). The modal enforces one daily note per date — if a file already exists at that path, it opens the existing note instead of creating a new one.

On submit:
- Generates frontmatter from the type's template
- Today's date auto-filled for `date` fields
- Calls `PUT /api/vault/note/[...path]` (the existing write handler) to create the file
- Passes an `onNoteCreated` callback to the modal; `page.tsx` calls `loadGraph()` + opens the note in DetailPanel

**`web/app/page.tsx`** — add `+ New Note` button to the top bar, wire to modal.

### 3.3 Inbox badge

**`inbox` is not a note type — it is a location.** Notes captured in `inbox/` have no required frontmatter and are treated as `type: 'note'` by the parser. The inbox filter is path-based (`path.startsWith('inbox/')`), not type-based.

**`web/app/api/vault/inbox/route.ts`** — new GET endpoint:
- Calls `getCachedGraph()` (reuses existing cache, no new VaultClient methods needed)
- Filters nodes by `path.startsWith('inbox/')`
- Returns `{ count: number }`
- Note: count reflects the cache state (up to 5min lag after new captures)

**`web/app/page.tsx`** — show inbox count badge next to an `Inbox` link in the top bar. Clicking filters the graph to show only nodes with `path.startsWith('inbox/')`.

---

## Data flow

```
User clicks "+ New Note"
  → NewNoteModal opens
  → User fills title + type
  → Template frontmatter generated client-side
  → PUT /api/vault/note/[path] (existing route, also calls invalidateCache())
  → Note created in vault (GitHub or local)
  → onNoteCreated() callback fires in page.tsx
  → page.tsx calls loadGraph() + sets selectedNote to new path
  → DetailPanel opens new note
```

---

## Out of scope

- AI chat interface (parked — use Claude Code + MCP instead)
- Note summaries / link suggestions (parked)
- Drag-and-drop folder management
- Quick capture as separate mobile page (Obsidian handles this)
- Persistent chat history

---

## Implementation order

1. Extend `types.ts` with new note types
2. Update `BrainGraph.tsx` with new type colors
3. Update `vault-parser.ts` type guards
4. Build `NewNoteModal.tsx` + wire to page
5. Build `/api/vault/inbox` route + inbox badge
6. Create `CLAUDE.md` template in vault root

---

## Success criteria

- All 8 note types (`person`, `project`, `idea`, `note`, `resource`, `meeting`, `daily`, `area`) render in the graph with correct colors; inbox notes render as `type: 'note'` (intentional — inbox is a location, not a type)
- New note modal creates a note with the correct frontmatter template in the correct default folder; graph reloads after creation
- Inbox badge shows count of notes in `inbox/` (reflects cache, may lag up to 5min)
- `CLAUDE.md` exists in vault root and Claude Code reads it at session start
- Capturing a new meeting/daily/idea via the modal is achievable without manual frontmatter editing (manually validated)
