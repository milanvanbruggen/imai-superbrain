# Superbrain

A personal knowledge graph that visualises your markdown vault as an interactive force-directed graph. Notes live in a GitHub repository; optionally, a local Obsidian vault folder can be connected and kept in sync automatically.

The app runs as a Next.js web application — locally for development and on Vercel for production. It also exposes an MCP server so AI tools like Claude Desktop can read, search, and write notes in your vault.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Create a vault repository](#1-create-a-vault-repository)
3. [Create a GitHub PAT](#2-create-a-github-pat)
4. [Run locally](#3-run-locally)
5. [Deploy to Vercel](#4-deploy-to-vercel)
6. [Auto-sync (local ↔ GitHub)](#5-auto-sync-local--github)
7. [MCP integration (Claude Desktop)](#6-mcp-integration-claude-desktop)
8. [Gmail integration (optional)](#7-gmail-integration-optional)
9. [Install as PWA on iPhone](#8-install-as-pwa-on-iphone)
10. [Vault structure](#vault-structure)
11. [Environment variables reference](#environment-variables-reference)

---

## Prerequisites

- **Node.js 18+** and npm
- A **GitHub account**
- *(optional)* [Obsidian](https://obsidian.md) for editing notes locally

---

## 1. Create a vault repository

Create a **new private GitHub repository** (e.g. `your-username/superbrain-vault`).

You can start with an empty repo — the app has a **Setup Wizard** that walks you through connecting your GitHub repo and optionally initializes a starter folder structure with system files for AI context. Or create it manually:

```bash
git clone https://github.com/YOUR_USERNAME/superbrain-vault.git ~/superbrain-vault

mkdir -p ~/superbrain-vault/{people,projects,ideas,notes,daily}
cd ~/superbrain-vault
git add .
git commit -m "init vault structure"
git push
```

If you use Obsidian, open this folder as a vault: **File → Open vault → Open folder as vault**.

---

## 2. Create a GitHub PAT

The app needs a Personal Access Token to read and write files in the vault repo.

1. Go to **GitHub → Settings → Developer settings → [Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)**
2. **Repository access**: select only the vault repository
3. **Permissions**: Contents → **Read and Write**
4. Generate and copy the token

---

## 3. Run locally

```bash
# Clone this repository
git clone https://github.com/YOUR_USERNAME/mai-superbrain.git
cd mai-superbrain/web

# Install dependencies
npm install

# Create your environment file
cp .env.local.example .env.local
```

Edit `.env.local` with your values:

```env
# Required — Authentication
ADMIN_PASSWORD=choose-a-strong-password
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

# GitHub vault (required)
GITHUB_PAT=github_pat_xxxx
GITHUB_VAULT_OWNER=your-username
GITHUB_VAULT_REPO=superbrain-vault
GITHUB_VAULT_BRANCH=main

# Local vault (optional — enables auto-sync when set alongside GitHub)
# VAULT_PATH=/Users/you/superbrain-vault
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your `ADMIN_PASSWORD`.

### Settings on localhost

In the app's **Settings** screen you can:

- **Local path** — set or change the path to your local vault folder
- **GitHub repository** — shown as read-only (always configured via env vars)
- **Auto-sync** — toggle bidirectional sync between local and GitHub (requires both to be configured)

---

## 4. Deploy to Vercel

1. Push this repository (`mai-superbrain`) to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import the repository
3. Set **Root Directory** to `web`
4. Add these **environment variables**:

| Variable | Value |
|----------|-------|
| `ADMIN_PASSWORD` | Password to log in |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `GITHUB_PAT` | Fine-grained PAT from step 2 |
| `GITHUB_VAULT_OWNER` | Your GitHub username |
| `GITHUB_VAULT_REPO` | Vault repo name |
| `GITHUB_VAULT_BRANCH` | *(optional)* Default: `main` |

5. Deploy

> **Note:** On Vercel the Settings screen shows a "Serverless mode" banner. Vault configuration is read-only and must be changed via Vercel's environment variable settings. Auto-sync is not available on Vercel (there is no local filesystem).

### Update `NEXTAUTH_URL`

After the first deploy, copy the actual Vercel URL (e.g. `https://mai-superbrain.vercel.app`) and update the `NEXTAUTH_URL` environment variable in Vercel to match. Redeploy.

---

## 5. Auto-sync (local ↔ GitHub)

Auto-sync keeps your local Obsidian vault and the GitHub repository in sync in real-time. It runs **only on localhost** (not on Vercel).

### Requirements

- `VAULT_PATH` is set (or configured in Settings → Local path)
- `GITHUB_PAT`, `GITHUB_VAULT_OWNER`, `GITHUB_VAULT_REPO` are set
- The app is running locally (`npm run dev`)

### How to enable

1. Open **Settings** in the app
2. Both "Local path" and "GitHub repository" should show as configured
3. Toggle **Auto-sync** on

### How it works

When enabled, the app polls every **5 seconds** and:

1. Reads the file tree from both the local vault and GitHub
2. Compares SHA hashes to detect changes since the last sync
3. Executes the appropriate action for each file:

| Local | GitHub | Action |
|-------|--------|--------|
| Changed | Unchanged | **Push** to GitHub |
| Unchanged | Changed | **Pull** to local |
| Changed | Changed | **Conflict** — local wins, remote saved as `.conflict.md` |
| New file | — | **Push** to GitHub |
| — | New file | **Pull** to local |
| Deleted | Unchanged | **Delete** on GitHub |
| Unchanged | Deleted | **Delete** locally |

### Conflict resolution

When the same file is edited on both sides between sync cycles:

- The **local version wins** and is pushed to GitHub
- The remote version is saved as `filename.conflict.md` in your local vault
- You can review the conflict file and merge manually

### First sync

The very first sync creates a **baseline snapshot** without changing any files. This records the current state of both sides. Actual syncing starts from the second cycle.

---

## 6. MCP integration (Claude Desktop)

The app exposes an MCP (Model Context Protocol) server at `/api/mcp`. This lets AI tools like Claude Desktop read, search, and write notes in your vault.

### Setup

Add to Claude Desktop's MCP settings (`~/.claude/mcp_settings.json`):

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

The MCP server requires OAuth authentication. The first time Claude connects, it will guide you through the authorization flow.

### Available tools

| Tool | Description |
|------|-------------|
| `get_context` | Returns your personal context (profile, active projects, memory) |
| `read_note` | Reads a specific vault note by path |
| `search_notes` | Full-text search across vault |
| `create_note` | Creates a new note |
| `update_note` | Updates an existing note |

> **Note:** MCP only works when the app is deployed to a public URL (Vercel). It is not available on localhost.

---

## 7. Gmail integration (optional)

Enables searching and summarising Gmail emails from within person notes. If not configured, Gmail functionality is hidden throughout the app.

### Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Enable the **Gmail API**
4. Add `<NEXTAUTH_URL>/api/auth/callback/google` as an authorized redirect URI
5. Get an API key from [Anthropic](https://console.anthropic.com/) for email summarization

Add to your environment:

```env
GOOGLE_CLIENT_ID=xxxx
GOOGLE_CLIENT_SECRET=xxxx
ANTHROPIC_API_KEY=sk-ant-xxxx
```

After restarting the app, go to **Settings → Integrations** and click **Connect Gmail**.

---

## 8. Install as PWA on iPhone

1. Open the deployed Vercel URL in **Safari** on iPhone
2. Tap **Share → Add to Home Screen**
3. The app works offline for cached content

---

## Vault structure

The folder structure determines note types in the graph. Each top-level folder maps to a type with a distinct color:

```
vault-repo/
├── people/       → person nodes (blue)
├── projects/     → project nodes (purple)
├── meetings/     → meeting nodes (teal)
├── daily/        → daily notes (amber)
├── ideas/        → idea nodes (pink)
├── resources/    → resource nodes (orange)
├── areas/        → area nodes (green)
├── notes/        → general notes (default)
├── Claude/       → system files (hidden by default)
│   ├── profile.md
│   ├── active-projects.md
│   └── memory/
└── archive/      → excluded from graph
```

Notes link to each other via `[[wikilinks]]`. The graph visualizes these connections.

---

## Environment variables reference

### Required

| Variable | Description | Local | Vercel |
|----------|-------------|:-----:|:------:|
| `ADMIN_PASSWORD` | Password to log in | ✅ | ✅ |
| `NEXTAUTH_SECRET` | Session encryption secret | ✅ | ✅ |
| `NEXTAUTH_URL` | App URL (`http://localhost:3000` or Vercel URL) | ✅ | ✅ |
| `GITHUB_PAT` | GitHub PAT with Contents: Read & Write | ✅ | ✅ |
| `GITHUB_VAULT_OWNER` | GitHub username | ✅ | ✅ |
| `GITHUB_VAULT_REPO` | Vault repository name | ✅ | ✅ |

### Optional

| Variable | Description | Local | Vercel |
|----------|-------------|:-----:|:------:|
| `GITHUB_VAULT_BRANCH` | Branch name (default: `main`) | ✅ | ✅ |
| `VAULT_PATH` | Absolute path to local vault folder | ✅ | — |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | ✅ | ✅ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | ✅ | ✅ |
| `ANTHROPIC_API_KEY` | Anthropic API key for email summaries | ✅ | ✅ |

---

## Running tests

```bash
npm test
```

---

## Troubleshooting

### "vault_not_configured" on Vercel

The GitHub environment variables are not set. Go to Vercel → Project Settings → Environment Variables and add `GITHUB_PAT`, `GITHUB_VAULT_OWNER`, `GITHUB_VAULT_REPO`.

### Auto-sync creates duplicate notes

Make sure you are running version `36a2f14` or later. Earlier versions had a SHA hash mismatch between local files and GitHub, causing false conflicts. If you still see issues, delete `vault-sync-state.json` in the `web/` directory to reset the sync baseline.

### "Failed to execute 'json' on 'Response'" in Settings

This was fixed in version `7505e0d`. The Settings screen now handles serverless environments gracefully instead of crashing on Vercel's read-only filesystem.
