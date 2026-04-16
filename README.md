# Superbrain

A personal knowledge graph that visualizes your markdown vault as an interactive force-directed graph.

Notes live in a GitHub repository and are connected through `[[wikilinks]]`. Optionally, a local [Obsidian](https://obsidian.md) vault can be synced automatically. An MCP server lets AI tools like Claude Desktop read, search, and write notes directly in your vault.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000?logo=nextdotjs&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?logo=vercel&logoColor=white)

---

## Features

- **Interactive knowledge graph** — force-directed visualization of all vault notes and their connections
- **Inbox review** — date-grouped inbox view with duplicate detection, merge suggestions, relation suggestions, and per-note or bulk approve; approved notes are moved to the correct type folder automatically
- **Relation editing** — add, edit (change type), and remove relations directly from the detail panel
- **Toast notifications** — non-intrusive feedback for all write actions (approve, merge, edit, delete, settings changes)
- **Daily inbox reminder** — banner when there are unprocessed inbox items; configurable in Settings
- **GitHub-backed vault** — notes are stored as markdown files in a GitHub repository
- **Obsidian sync** — optional bidirectional sync with a local Obsidian vault (localhost only)
- **MCP server** — AI tools can read, search, write, and delete notes via the Model Context Protocol
- **Gmail integration** — search and summarize email conversations from within person notes
- **Setup Wizard** — guided onboarding with optional template vault (folders, system files, note templates)
- **PWA support** — installable on mobile devices for offline access
- **Dark mode** — full dark/light theme support

---

## Quick start

```bash
# Clone the repository
git clone https://github.com/milanvanbruggen/mai-superbrain.git
cd mai-superbrain/web

# Install dependencies
npm install

# Create your environment file
cp .env.local.example .env.local
# Edit .env.local with your values (see below)

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your `ADMIN_PASSWORD`.

If running for the first time without GitHub configured, the **Setup Wizard** will guide you through connecting your vault repository.

### Minimum environment variables

```env
ADMIN_PASSWORD=choose-a-strong-password
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
VAULT_CONFIG={"remote":{"provider":"github","token":"github_pat_xxxx","owner":"your-username","repo":"superbrain-vault","branch":"main"}}
```

### Vault configuration

Vault sources are configured via a single `VAULT_CONFIG` JSON environment variable. At least one source (local or remote) must be set.

**GitHub:**
```env
VAULT_CONFIG={"remote":{"provider":"github","token":"github_pat_xxxx","owner":"yourusername","repo":"your-vault-repo","branch":"main"}}
```

**GitLab (self-hosted):**
```env
VAULT_CONFIG={"remote":{"provider":"gitlab","token":"glpat-xxxx","namespace":"yourusername","project":"your-vault-repo","branch":"main","url":"https://gitlab.yourcompany.com"}}
```

**Local + GitHub sync** (bidirectional sync, localhost only):
```env
VAULT_CONFIG={"remote":{"provider":"github","token":"github_pat_xxxx","owner":"yourusername","repo":"your-vault-repo","branch":"main"},"local":{"path":"/Users/you/my-vault"}}
```

On **localhost**, the Setup Wizard writes `vault-config.json` automatically — no manual editing needed. On **Vercel**, set `VAULT_CONFIG` as an environment variable in your project settings.

The legacy `GITHUB_PAT`, `GITHUB_VAULT_OWNER`, `GITHUB_VAULT_REPO`, `GITHUB_VAULT_BRANCH`, and `VAULT_PATH` env vars are still supported for backward compatibility.

---

## Documentation

See [web/README.md](web/README.md) for the full setup guide, including:

- Creating a vault repository and GitHub PAT
- Deploying to Vercel
- Auto-sync between local vault and GitHub
- MCP integration (Claude Desktop)
- Gmail integration
- Environment variables reference
- Troubleshooting

---

## Project structure

```
mai-superbrain/
├── web/              → Next.js web application (main app)
│   ├── app/          → App routes and API endpoints
│   ├── components/   → React components
│   ├── lib/          → Shared utilities, vault client, sync logic
│   └── public/       → Static assets
├── mcp/              → MCP server (standalone, for local Claude Desktop)
│   └── src/          → Vault reader, tools, parser
└── scripts/          → Sync and import utility scripts
```

---

## Running tests

```bash
# Web app tests
cd web && npm test

# MCP server tests
cd mcp && npm test
```

---

## License

[Business Source License 1.1](LICENSE) — free for non-production use. Converts to MIT four years after each release.
