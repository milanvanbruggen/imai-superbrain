#!/usr/bin/env bash
set -euo pipefail

DIRECTION="${1:-}"
WRITTEN_FILE="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../web/.env.local"

# Load env vars from web/.env.local
load_env() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d '=' -f2- | sed "s/^['\"]//; s/['\"]$//" || true
  fi
}

# ── Vault path ────────────────────────────────────────────────────────────────
if [[ -z "${VAULT_PATH:-}" ]]; then
  VAULT_PATH="$(load_env VAULT_PATH)"
  export VAULT_PATH
fi

if [[ -z "${VAULT_PATH:-}" ]]; then
  echo "Error: VAULT_PATH is not set and could not be loaded from web/.env.local" >&2
  exit 1
fi

# ── Memory paths ──────────────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)"
PROJECT_SLUG=$(echo "$REPO_ROOT" | sed 's|^/||; s|/|-|g')
LOCAL_MEMORY="$HOME/.claude/projects/$PROJECT_SLUG/memory"
VAULT_MEMORY="${VAULT_PATH}/Claude/memory"

# ── Directions ────────────────────────────────────────────────────────────────

if [[ "$DIRECTION" == "local-to-vault" ]]; then
  # Guard: only sync when the written file is inside LOCAL_MEMORY
  if [[ -n "$WRITTEN_FILE" && "$WRITTEN_FILE" != "$LOCAL_MEMORY/"* ]]; then
    exit 0
  fi
  if [[ ! -d "$LOCAL_MEMORY" ]]; then
    exit 0
  fi
  mkdir -p "$VAULT_MEMORY"
  rsync -a --update "$LOCAL_MEMORY/" "$VAULT_MEMORY/" || true

elif [[ "$DIRECTION" == "vault-to-local" ]]; then
  if [[ ! -d "$VAULT_MEMORY" ]]; then
    echo "No vault memory directory found at $VAULT_MEMORY — skipping"
    exit 0
  fi
  mkdir -p "$LOCAL_MEMORY"
  rsync -a --update "$VAULT_MEMORY/" "$LOCAL_MEMORY/" || true

elif [[ "$DIRECTION" == "vault-to-github" ]]; then
  GITHUB_OWNER="${GITHUB_VAULT_OWNER:-$(load_env GITHUB_VAULT_OWNER)}"
  GITHUB_REPO="${GITHUB_VAULT_REPO:-$(load_env GITHUB_VAULT_REPO)}"
  GITHUB_BRANCH="${GITHUB_VAULT_BRANCH:-$(load_env GITHUB_VAULT_BRANCH)}"
  GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

  if [[ -z "$GITHUB_OWNER" || -z "$GITHUB_REPO" ]]; then
    echo "Error: GITHUB_VAULT_OWNER and GITHUB_VAULT_REPO must be set in web/.env.local" >&2
    exit 1
  fi

  CLONE_DIR="/tmp/superbrain-vault-sync"

  # Clone or pull
  if [[ -d "$CLONE_DIR/.git" ]]; then
    echo "Pulling latest from GitHub vault..."
    git -C "$CLONE_DIR" pull origin "$GITHUB_BRANCH" --quiet
  else
    echo "Cloning GitHub vault..."
    rm -rf "$CLONE_DIR"
    gh repo clone "${GITHUB_OWNER}/${GITHUB_REPO}" "$CLONE_DIR" -- --quiet
  fi

  # Sync local vault → clone (exclude Obsidian internals)
  rsync -a --delete \
    --exclude='.obsidian/' \
    --exclude='.DS_Store' \
    --exclude='*.icloud' \
    "${VAULT_PATH}/" "$CLONE_DIR/"

  # Check for changes
  git -C "$CLONE_DIR" add -A
  if git -C "$CLONE_DIR" diff --cached --quiet; then
    echo "GitHub vault already up to date."
    exit 0
  fi

  # Show what changed
  echo "Changes to sync:"
  git -C "$CLONE_DIR" diff --cached --stat

  # Commit and push
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
  git -C "$CLONE_DIR" commit -m "sync: vault update ${TIMESTAMP}"
  git -C "$CLONE_DIR" push --quiet

  echo "GitHub vault updated."

else
  echo "Usage: sync-brain.sh <local-to-vault|vault-to-local|vault-to-github>" >&2
  exit 1
fi
