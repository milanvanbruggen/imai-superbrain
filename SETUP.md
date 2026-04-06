# Mai Superbrain — Setup Guide

A personal knowledge system: Obsidian vault synced to GitHub, accessible via a Next.js web app on Vercel and an MCP server that gives Claude Code access to your vault and personal context.

## Architecture

```
Obsidian vault (local, iCloud)
    ↕ sync-vault.sh (git, every 5 min via launchd)
GitHub vault repo  ←→  Vercel Next.js PWA  (GitHub API)
                            ↓
                   MCP server (HTTP, /api/mcp)
                            ↓
                   Claude Code (get_context, read_note, …)

Claude Code local memory (~/.claude/projects/…/memory/)
    ↕ sync-brain.sh (rsync, PostToolUse hook + session start)
Vault: Claude/memory/
```

---

## Prerequisites

- Node.js 18+, npm 9+
- Git
- A GitHub account
- Obsidian (desktop)
- macOS (for the launchd sync agent; Linux users: use a cron job instead)

---

## 1. Create the Vault Repository

Create a **new private GitHub repository** to serve as your vault (e.g. `your-username/superbrain-vault`).

Clone it locally — Obsidian requires a path without symlinks:

```bash
git clone https://github.com/YOUR_USERNAME/superbrain-vault.git ~/superbrain-vault
```

Create the initial folder structure:

```bash
mkdir -p ~/superbrain-vault/{Claude/memory,people,projects,ideas,notes}
touch ~/superbrain-vault/Claude/memory/.gitkeep
git -C ~/superbrain-vault add .
git -C ~/superbrain-vault commit -m "init vault structure"
git -C ~/superbrain-vault push
```

Open it as an Obsidian vault: **File → Open vault → Open folder as vault**, select the cloned folder.

> **iCloud note:** If Obsidian stores the vault inside iCloud (`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/`), use that path everywhere below instead of `~/superbrain-vault`.

---

## 2. GitHub OAuth App

Go to **GitHub Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|-------|-------|
| Application name | Superbrain |
| Homepage URL | `https://your-app.vercel.app` |
| Authorization callback URL | `https://your-app.vercel.app/api/auth/callback/github` |

Save the **Client ID** and **Client Secret**.

---

## 3. GitHub Personal Access Token (PAT)

Go to **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens**.

Create a token scoped to the vault repository only:
- Repository access: Only the vault repo
- Permissions: **Contents** — Read and Write

Save the token.

---

## 4. Find Your Numeric GitHub User ID

```bash
curl https://api.github.com/users/YOUR_USERNAME | grep '"id"'
```

Note the numeric ID (e.g. `12345678`).

---

## 5. Deploy to Vercel

1. Push this (`mai-superbrain`) repository to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import this repository
3. Set **Root Directory** to `web`
4. Add these environment variables:

| Variable | Value |
|----------|-------|
| `GITHUB_PAT` | Fine-grained PAT from Step 3 |
| `GITHUB_VAULT_OWNER` | Your GitHub username |
| `GITHUB_VAULT_REPO` | Vault repo name (e.g. `superbrain-vault`) |
| `GITHUB_CLIENT_ID` | OAuth App Client ID from Step 2 |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret from Step 2 |
| `ALLOWED_GITHUB_USER_ID` | Numeric GitHub user ID from Step 4 |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `GITHUB_VAULT_BRANCH` | *(optional)* Branch name, default `main` |

5. Deploy, then update the OAuth App's Homepage URL and callback URL to the real Vercel URL.

---

## 6. Configure MCP in Claude Code

The MCP server runs on Vercel at `/api/mcp`. Add it to `~/.claude/mcp_settings.json`:

```json
{
  "mcpServers": {
    "superbrain": {
      "type": "http",
      "url": "https://your-app.vercel.app/api/mcp"
    }
  }
}
```

The MCP server exposes these tools to Claude:
- `get_context` — returns your personal context (profile, active projects, memory)
- `read_note` — reads a specific vault note
- `search_notes` — full-text search across vault
- `create_note` / `update_note` — create or update notes

---

## 7. Configure Local Development (optional)

For running the app locally:

```bash
cp web/.env.local.example web/.env.local
```

Fill in the same values as in Step 5, plus:

| Variable | Value |
|----------|-------|
| `VAULT_PATH` | Absolute path to your local vault clone (e.g. `/Users/you/superbrain-vault`) |

Then:

```bash
cd web && npm install && npm run dev
```

---

## 8. Claude Code Memory Sync

This syncs Claude Code's local memory (`.claude/projects/…/memory/`) bidirectionally with the vault's `Claude/memory/` directory. Changes written by Claude Code automatically appear in Obsidian, and changes made in Obsidian are pulled in at the start of each Claude Code session.

### 8a. Set VAULT_PATH

Add to `web/.env.local`:

```
VAULT_PATH=/absolute/path/to/your/vault
```

The `sync-brain.sh` script reads this value.

### 8b. Add the PostToolUse Hook

Add to `~/.claude/settings.json` (inside the top-level `"hooks"` object):

```json
"PostToolUse": [
  {
    "matcher": "Write",
    "hooks": [
      {
        "type": "command",
        "command": "bash /absolute/path/to/mai-superbrain/scripts/sync-brain.sh local-to-vault \"${TOOL_INPUT_PATH}\""
      }
    ]
  }
]
```

Replace `/absolute/path/to/mai-superbrain` with the actual path to this repository.

### 8c. Session-Start Sync

The repo's `CLAUDE.md` already contains:

```
At the start of each session, run: bash scripts/sync-brain.sh vault-to-local
```

Claude Code reads this automatically at session start.

---

## 9. Bootstrap Vault Files

Create the two files Claude Code reads for personal context:

**`Claude/profile.md`** — Who you are, your roles, tech stack, working style.

**`Claude/active-projects.md`** — Current projects with status and open points.

These files live in the vault repo. Edit them directly in Obsidian. Claude Code's `get_context` MCP tool reads them to get up-to-date personal context.

Example structure for `Claude/profile.md`:

```markdown
# Profile — Your Name

Brief bio and current focus.

## Roles
- Role 1
- Role 2

## Tech Stack
- Next.js, TypeScript, Vercel
- …

## How you work
- …
```

---

## 10. Periodic Vault ↔ GitHub Sync (macOS)

This keeps your local Obsidian vault in sync with the GitHub vault repo, so notes added via the web app or MCP are pulled in automatically.

### 10a. Initialize Git in the Vault

If the vault is already a git repo (from Step 1), skip this. Otherwise:

```bash
cd /path/to/vault
git init
git remote add origin https://github.com/YOUR_USERNAME/superbrain-vault.git
git branch -M main
git pull origin main
```

### 10b. Install the Launchd Agent

Copy the plist file to the LaunchAgents directory:

```bash
cp /path/to/mai-superbrain/config/com.yourname.sync-vault.plist \
   ~/Library/LaunchAgents/com.yourname.sync-vault.plist
```

Or create `~/Library/LaunchAgents/com.yourname.sync-vault.plist` manually:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yourname.sync-vault</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/absolute/path/to/mai-superbrain/scripts/sync-vault.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>WorkingDirectory</key>
    <string>/Users/yourname</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/sync-vault.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/sync-vault.log</string>
</dict>
</plist>
```

Update the vault path inside `scripts/sync-vault.sh` (line 7):

```bash
V="/absolute/path/to/your/vault"
```

Load the agent:

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.sync-vault.plist
```

### 10c. Grant Full Disk Access

macOS restricts launchd agents from accessing iCloud Drive. If your vault is in iCloud:

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Add `/bin/bash`
3. Restart the agent: `launchctl unload …plist && launchctl load …plist`

Check the log to verify: `tail -f /tmp/sync-vault.log`

### Sync behavior

- Commits all local changes with message `vault: auto-sync YYYY-MM-DD HH:MM`
- Fetches from GitHub; skips silently if offline
- Merges remote changes; on conflict: **local version wins**
- Pushes to GitHub

---

## 11. Install as PWA on iPhone (optional)

1. Open the deployed Vercel URL in Safari on iPhone
2. Tap Share → **Add to Home Screen**

---

## Reinstallation Checklist

When setting up on a new machine:

- [ ] Clone this repo (`mai-superbrain`)
- [ ] Clone the vault repo
- [ ] Open vault in Obsidian
- [ ] Copy `web/.env.local.example` → `web/.env.local`, fill in values + `VAULT_PATH`
- [ ] Add MCP server to `~/.claude/mcp_settings.json` (Step 6)
- [ ] Add PostToolUse hook to `~/.claude/settings.json` (Step 8b)
- [ ] Create/copy `~/Library/LaunchAgents/com.yourname.sync-vault.plist` (Step 10b)
- [ ] Update `VAULT_PATH` in `scripts/sync-vault.sh` (Step 10b)
- [ ] Load the launchd agent (Step 10b)
- [ ] Grant Full Disk Access to `/bin/bash` if vault is in iCloud (Step 10c)
- [ ] Verify sync: `tail -f /tmp/sync-vault.log`
- [ ] Create `Claude/profile.md` and `Claude/active-projects.md` in vault (Step 9)
