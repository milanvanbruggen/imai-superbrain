# Mai Superbrain — Setup Guide

## Prerequisites

- Node.js 18+
- npm 9+
- A GitHub account

---

## 1. Create the Vault Repository

Create a **new private GitHub repository** to serve as your vault (e.g. `your-username/my-vault`).

Clone it locally:
```bash
git clone https://github.com/YOUR_USERNAME/your-vault-repo.git ~/vault
```

Create the initial folder structure:
```bash
mkdir -p ~/vault/{people,projects,ideas,notes}
touch ~/vault/people/.gitkeep ~/vault/projects/.gitkeep ~/vault/ideas/.gitkeep ~/vault/notes/.gitkeep
git -C ~/vault add . && git -C ~/vault commit -m "init vault structure" && git -C ~/vault push
```

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

Create a token with access to the vault repository:
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

1. Push this repository to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import this repository
3. Set **Root Directory** to `web`
4. Add these environment variables:

| Variable | Value |
|----------|-------|
| `GITHUB_PAT` | Your fine-grained PAT from Step 3 |
| `GITHUB_VAULT_OWNER` | Your GitHub username |
| `GITHUB_VAULT_REPO` | Your vault repo name (e.g. `my-vault`) |
| `GITHUB_CLIENT_ID` | OAuth App Client ID from Step 2 |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret from Step 2 |
| `ALLOWED_GITHUB_USER_ID` | Your numeric GitHub user ID from Step 4 |
| `NEXTAUTH_SECRET` | Run: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |

5. Deploy. Update the Vercel deployment URL in the OAuth App settings (Step 2).

---

## 6. Install on iPhone (PWA)

1. Open the deployed URL in Safari on your iPhone
2. Tap the Share button → **Add to Home Screen**
3. The app will install as a standalone PWA

---

## 7. Configure MCP Server for Claude Code

Build the MCP server:
```bash
cd /path/to/mai-superbrain/mcp
npm install
npm run build
```

Add to `~/.claude/mcp_settings.json`:
```json
{
  "mcpServers": {
    "superbrain": {
      "command": "node",
      "args": ["/path/to/mai-superbrain/mcp/dist/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/local/vault/clone"
      }
    }
  }
}
```

Replace `/path/to/mai-superbrain` with the actual path to this repo, and `/path/to/your/local/vault/clone` with the path where you cloned the vault in Step 1.

---

## 8. Obsidian Setup

1. Open your local vault clone as an Obsidian vault: **File → Open vault → Open folder as vault**
2. Install the **Obsidian Git** plugin (Settings → Community plugins → Browse → search "Obsidian Git")
3. Configure it:
   - Auto pull on startup: ✓
   - Auto push after file change: ✓ (or on a timer)

This keeps your local vault in sync with the GitHub vault repo, so changes made in the web app (which commits via GitHub API) are reflected in Obsidian after a pull.

---

## Environment Variables Reference

See `web/.env.local.example` for the full list with descriptions. For local development:

```bash
cp web/.env.local.example web/.env.local
# Fill in the values, then:
cd web && npm run dev
```

---

## Architecture Summary

```
GitHub vault repo (markdown + wikilinks)
    ↕ git pull/push (Obsidian Git plugin)      ↕ GitHub API (PAT)
Local vault clone                              Vercel Next.js PWA
    ↕ filesystem reads                            (graph view + editor)
Obsidian desktop app     MCP server
                         (Claude Code reads vault via VAULT_PATH)
```
