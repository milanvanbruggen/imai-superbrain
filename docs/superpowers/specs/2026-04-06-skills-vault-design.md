# Claude Skills in Superbrain — Design Spec

## Goal

Import Claude Code skills from `~/.claude/skills/` as readable and editable `resource` nodes in the Superbrain vault, linked to the existing `Claude Setup` node. The vault becomes a shareable skill library — colleagues can browse and use skills, and improvements made in Superbrain can be manually synced back to the local Claude skills directory.

## Scope

- **In scope:** User-defined skills in `~/.claude/skills/` (ui-ux-pro-max, invoice-downloader, ux-engineer)
- **Out of scope:** Superpowers/plugin skills, automatic live sync, new node types

## Vault Structure

Each skill becomes a separate `resource` note in `resources/`:

```
resources/
  skill-ui-ux-pro-max.md
  skill-invoice-downloader.md
  skill-ux-engineer.md
```

### Note format

```markdown
---
title: <H1 heading from SKILL.md, fallback: directory name>
type: resource
tags: [tools, claude, skill]
date: 2026-04-06
relations:
  - target: "[[Claude Setup]]"
    type: part_of
---

<contents of SKILL.md, YAML frontmatter block stripped>
```

**Title derivation:** the `title` field is taken from the first `# ` heading line in `SKILL.md`. If no H1 is present, the directory name is used as-is.

**Frontmatter stripping:** the YAML block is delimited by the first and second `---` lines. The script strips everything up to and including the second `---`. Implementation: `awk '/^---/{n++; next} n>=2{print}'`. All current skill files are assumed to contain a YAML frontmatter block; if no second `---` is found, the entire file is written as-is (fallback: `n < 2` → print whole file).

**Skipping invalid entries:** the script skips any entry under `~/.claude/skills/` that is not a directory, or whose directory does not contain a `SKILL.md` file.

## Claude Setup Update

The existing `resources/Claude Setup.md` skills table is updated **manually** to replace plain skill names with wikilinks to the individual skill notes, e.g. `[[skill-ui-ux-pro-max]]`. Skills listed in that table that do not exist in `~/.claude/skills/` (e.g. legacy entries) are left as plain text.

## Sync Script

A shell script committed to the Superbrain repo at `scripts/import-skills.sh` (and symlinked or copied to `~/.claude/skills/import-to-vault.sh` for convenience) handles one-way import.

The script:
1. Reads each skill directory under `~/.claude/skills/`
2. Skips entries that are not directories or lack a `SKILL.md`
3. Strips YAML frontmatter from `SKILL.md` using `awk '/^---/{n++; next} n>=2{print}'`
4. Extracts the `title` from the first `# ` heading; falls back to directory name
5. Writes the vault note with the correct frontmatter template
6. **Overwrite policy:** always overwrites the vault note (no mtime check — iCloud Drive makes mtime comparisons unreliable). The user is responsible for not running the script when unsaved edits exist in the vault.

## Workflow for Sharing

1. Edit a skill in Superbrain (or directly in `~/.claude/skills/`)
2. Run `scripts/import-skills.sh` to sync into the vault
3. Vault is shared via iCloud or pushed to GitHub — colleagues see the latest version

## Non-goals

- No live coupling between vault and `~/.claude/skills/`
- No new graph node types (`resource` is sufficient)
- No auto-run of the sync script
- No mtime-based conflict detection
