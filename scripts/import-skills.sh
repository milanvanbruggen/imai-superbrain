#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$HOME/.claude/skills"
VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain"
RESOURCES="$VAULT/resources"
TODAY=$(date +%Y-%m-%d)

mkdir -p "$RESOURCES"

import_skill() {
  local skill_file="$1"
  local dir_name="$2"
  local vault_note="$RESOURCES/skill-${dir_name}.md"

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
}

# 1. User-defined skills from ~/.claude/skills/
for skill_dir in "$SKILLS_DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_file="$skill_dir/SKILL.md"
  [ -f "$skill_file" ] || continue
  import_skill "$skill_file" "$(basename "$skill_dir")"
done

# 2. Personal Cowork skills from Claude.ai session store
# Finds the skills/ directory under skills-plugin/<uuid>/<uuid>/skills/
COWORK_SKILLS=$(find "$HOME/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin" \
  -mindepth 3 -maxdepth 3 -type d -name "skills" 2>/dev/null | sort | tail -1)

if [ -n "$COWORK_SKILLS" ]; then
  for skill_dir in "$COWORK_SKILLS"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_file="$skill_dir/SKILL.md"
    [ -f "$skill_file" ] || continue
    dir_name=$(basename "$skill_dir")
    # Skip skills already imported from ~/.claude/skills/ (avoid duplicates)
    [ -f "$RESOURCES/skill-${dir_name}.md" ] && continue
    import_skill "$skill_file" "$dir_name"
  done
fi

# 3. Skills stored inside local session .claude/skills/ dirs (e.g. linkedin-post)
while IFS= read -r skill_file; do
  dir_name=$(basename "$(dirname "$skill_file")")
  # Skip if already imported
  [ -f "$RESOURCES/skill-${dir_name}.md" ] && continue
  import_skill "$skill_file" "$dir_name"
done < <(find "$HOME/Library/Application Support/Claude/local-agent-mode-sessions" \
  -path "*/.claude/skills/*/SKILL.md" 2>/dev/null | sort -u)
