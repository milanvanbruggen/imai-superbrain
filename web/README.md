# Superbrain

A personal knowledge graph app that visualises your markdown vault as an interactive graph. Notes live in a GitHub repository which acts as the source of truth. You can also connect a local vault folder and enable bidirectional sync between the two.

## Prerequisites

- Node.js 18+
- A GitHub repository to use as your vault — containing markdown files (can be a new empty repo)

---

## Setup

### 1. Install dependencies

```bash
cd web
npm install
```

### 2. Create your environment file

```bash
cp .env.local.example .env.local
```

Then fill in the required variables (see below).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

### Required

These must be set for the app to start and authenticate.

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password to log in to the app |
| `NEXTAUTH_SECRET` | Random secret for session encryption (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | The URL the app is running on (e.g. `http://localhost:3000`) |

### Required for vault access

The app needs to read your vault. You can configure this via the Settings screen in the app after logging in — no env vars needed. Alternatively, set them upfront:

| Variable | Description |
|---|---|
| `GITHUB_PAT` | Fine-grained GitHub personal access token with read/write access to the vault repo |
| `GITHUB_VAULT_OWNER` | GitHub username that owns the vault repo |
| `GITHUB_VAULT_REPO` | Name of the vault repository |
| `GITHUB_VAULT_BRANCH` | Branch to use (default: `main`) |

**Creating a PAT:**
Go to GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens.
Grant **Contents: Read and write** access to the vault repository only.

If you configure the vault via the Settings screen instead, these env vars are not needed.

### Optional — Gmail integration

Enables searching and summarising Gmail emails from within a person note. If these are not set, Gmail functionality is hidden throughout the app.

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth App client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth App client secret |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI email summarisation |

**Creating a Google OAuth App:**
Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth 2.0 Client ID.
Enable the Gmail API. Add `<NEXTAUTH_URL>/api/auth/callback/google` as an authorised redirect URI.

---

## Vault setup

The app reads markdown files from your vault repository. The folder structure is used to determine note types:

```
vault-repo/
├── people/
├── projects/
├── meetings/
├── daily/
├── ideas/
├── resources/
├── areas/
└── notes/
```

An empty repository is fine — you can initialise it from the app's empty state screen.

### Local vault + sync

You can also point the app at a local folder (e.g. an Obsidian vault). Configure the local path in Settings. When both a local path and a GitHub repo are configured, you can enable **auto-sync** to keep them in sync automatically. Local changes win on conflict; the remote version is saved as a `.conflict.md` file.

---

## Running tests

```bash
npm test
```
