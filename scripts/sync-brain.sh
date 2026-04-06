#!/usr/bin/env bash
set -euo pipefail

DIRECTION="${1:-}"
WRITTEN_FILE="${2:-}"

# Load VAULT_PATH from web/.env.local if not already set
if [[ -z "${VAULT_PATH:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../web/.env.local"
  if [[ -f "$ENV_FILE" ]]; then
    VAULT_PATH="$(grep '^VAULT_PATH=' "$ENV_FILE" | cut -d '=' -f2- | sed "s/^['\"]//; s/['\"]$//")"
    export VAULT_PATH
  fi
fi

if [[ -z "${VAULT_PATH:-}" ]]; then
  echo "Error: VAULT_PATH is not set and could not be loaded from web/.env.local" >&2
  exit 1
fi

# Derive LOCAL_MEMORY path from git root (Claude Code convention: replace / with -)
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)"
PROJECT_SLUG=$(echo "$REPO_ROOT" | sed 's|^/||; s|/|-|g')
LOCAL_MEMORY="$HOME/.claude/projects/$PROJECT_SLUG/memory"
VAULT_MEMORY="${VAULT_PATH}/Claude/memory"

if [[ "$DIRECTION" == "local-to-vault" ]]; then
  # Guard: only sync when the written file is inside LOCAL_MEMORY
  if [[ -n "$WRITTEN_FILE" && "$WRITTEN_FILE" != "$LOCAL_MEMORY/"* ]]; then
    exit 0
  fi
  if [[ ! -d "$LOCAL_MEMORY" ]]; then
    exit 0  # nothing to sync yet
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

else
  echo "Usage: sync-brain.sh <local-to-vault|vault-to-local> [written-file-path]" >&2
  exit 1
fi
