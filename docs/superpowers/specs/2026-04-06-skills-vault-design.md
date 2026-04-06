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
title: <Skill Display Name>
type: resource
tags: [tools, claude, skill]
date: 2026-04-06
relations:
  - target: "[[Claude Setup]]"
    type: part_of
---

<contents of SKILL.md, frontmatter stripped>
```

For skills with a directory structure (e.g. `ui-ux-pro-max/` with scripts/CSVs), only the main `SKILL.md` content is included. Supporting files are implementation details not suitable for the vault.

## Claude Setup Update

The existing `resources/Claude Setup.md` skills table is updated to link to each individual skill note using wikilinks, e.g. `[[skill-ui-ux-pro-max]]`.

## Sync Script

A shell script at `~/.claude/skills/import-to-vault.sh` handles the one-way import from `~/.claude/skills/` into the vault. It is run manually whenever skills need to be synced.

The script:
1. Reads each skill directory under `~/.claude/skills/`
2. Strips the YAML frontmatter from `SKILL.md`
3. Writes the vault note with the correct frontmatter template
4. Does not overwrite if the vault note has been edited more recently (safety check via mtime)

## Workflow for Sharing

1. Edit a skill in Superbrain (or directly in `~/.claude/skills/`)
2. Run `import-to-vault.sh` to sync into the vault
3. Vault is shared via iCloud or pushed to GitHub — colleagues see the latest version

## Non-goals

- No live coupling between vault and `~/.claude/skills/`
- No new graph node types (`resource` is sufficient)
- No auto-run of the sync script
