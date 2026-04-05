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

**Deliverable:** A blank `CLAUDE.md` template committed to the vault root (not the app repo). Milan fills in the content.

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

**`web/lib/vault-parser.ts`** — update any type guards or switch statements.

### 3.2 Template-based new note creation

**New component: `NewNoteModal.tsx`**

A modal triggered by a `+ New Note` button in the main UI. Fields:
- Title (text input)
- Type (select: all 8 types)
- Folder (auto-suggested based on type, editable)

On submit:
- Generates frontmatter from the type's template
- Today's date auto-filled for `date` fields
- Calls existing `POST /api/vault/note/[...path]` to create the file
- Opens the new note in DetailPanel

**`web/app/page.tsx`** — add `+ New Note` button to the top bar, wire to modal.

### 3.3 Inbox badge

**`web/app/api/vault/inbox/route.ts`** — new GET endpoint:
- Reads `inbox/` folder from vault
- Returns count of files

**`web/app/page.tsx`** — show inbox count badge next to a `Inbox` link in the top bar. Clicking navigates to a filtered graph view showing only inbox notes (filter by path prefix `inbox/`).

---

## Data flow

```
User clicks "+ New Note"
  → NewNoteModal opens
  → User fills title + type
  → Template frontmatter generated client-side
  → POST /api/vault/note/[path] (existing route)
  → Note created in vault (GitHub or local)
  → Graph cache invalidated
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

- All 8 note types render correctly in the graph with correct colors
- New note modal creates a note with the correct template in the correct folder
- Inbox badge shows live count of unprocessed notes
- `CLAUDE.md` exists in vault root and Claude Code reads it at session start
- Milan can capture a new meeting/daily/idea in < 30 seconds via the webapp
