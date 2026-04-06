#!/usr/bin/env bash
# Bidirectional sync between local Obsidian vault and GitHub.
# Runs every 5 minutes via launchd. On conflict: local (Obsidian) wins.

set -uo pipefail

V="/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain"

# Stage all local changes
git -C "$V" add -A

# Commit local changes if any
if ! git -C "$V" diff --cached --quiet; then
    git -C "$V" commit -m "vault: auto-sync $(date '+%Y-%m-%d %H:%M')"
fi

# Fetch remote; skip silently if no network
git -C "$V" fetch origin main 2>/dev/null || exit 0

# Merge remote into local; on conflict keep local (Obsidian edits = source of truth)
if ! git -C "$V" merge origin/main --no-edit -q 2>/dev/null; then
    git -C "$V" checkout --ours -- .
    git -C "$V" add -A
    git -C "$V" commit -m "vault: merge conflict resolved (kept local)" --no-edit
fi

# Push
git -C "$V" push origin main -q || true
