#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$HOME/.claude/skills"
VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain"
RESOURCES="$VAULT/resources"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$RESOURCES"

for skill_dir in "$SKILLS_DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_file="$skill_dir/SKILL.md"
  [ -f "$skill_file" ] || continue

  dir_name=$(basename "$skill_dir")
  vault_note="$RESOURCES/skill-${dir_name}.md"

  # Extract H1 title (first line starting with "# "); fallback to dir name
  title=$(grep -m1 '^# ' "$skill_file" | sed 's/^# //' || echo "$dir_name")
  [ -z "$title" ] && title="$dir_name"

  # Strip YAML frontmatter: print lines after the second "---"
  # If no second "---" found (n never reaches 2), print the whole file
  body=$(awk '
    /^---/ && n < 2 { n++; next }
    n >= 2          { print }
  ' "$skill_file")
  if [ -z "$body" ]; then
    body=$(cat "$skill_file")
  fi

  cat > "$vault_note" <<EOF
---
title: "${title}"
type: resource
tags: [tools, claude, skill]
date: ${TODAY}
relations:
  - target: "[[Claude Setup]]"
    type: part_of
---

${body}
EOF

  echo "✓ $vault_note"
done
