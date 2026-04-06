#!/usr/bin/env bash
# Bidirectional sync between local Obsidian vault and GitHub.
# Triggered instantly via launchd WatchPaths on file changes,
# and periodically every 60s to catch remote changes.
# On conflict: local (Obsidian) wins.

set -uo pipefail

V="/Users/milanvanbruggen/Library/Mobile Documents/iCloud~md~obsidian/Documents/Milan's Brain"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Stage all local changes
git -C "$V" add -A

# Commit local changes if any
if ! git -C "$V" diff --cached --quiet; then
    CHANGED=$(git -C "$V" diff --cached --name-only | wc -l | tr -d ' ')
    git -C "$V" commit -m "vault: auto-sync $(date '+%Y-%m-%d %H:%M') ($CHANGED files)"
    echo "$LOG_PREFIX pushed $CHANGED changed file(s)"
fi

# Fetch remote; skip silently if no network
if ! git -C "$V" fetch origin main 2>/dev/null; then
    echo "$LOG_PREFIX fetch failed (no network?), skipping pull"
    exit 0
fi

# Check if remote has new commits
BEHIND=$(git -C "$V" rev-list HEAD..origin/main --count 2>/dev/null || echo 0)

if [ "$BEHIND" -gt 0 ]; then
    # Merge remote into local; on conflict keep local (Obsidian edits = source of truth)
    if ! git -C "$V" merge origin/main --no-edit -q 2>/dev/null; then
        git -C "$V" checkout --ours -- .
        git -C "$V" add -A
        git -C "$V" commit -m "vault: merge conflict resolved (kept local)"
        echo "$LOG_PREFIX merged $BEHIND remote commit(s) (conflict resolved, kept local)"
    else
        echo "$LOG_PREFIX pulled $BEHIND remote commit(s)"
    fi
fi

# Push if we're ahead
AHEAD=$(git -C "$V" rev-list origin/main..HEAD --count 2>/dev/null || echo 0)
if [ "$AHEAD" -gt 0 ]; then
    git -C "$V" push origin main -q
fi
