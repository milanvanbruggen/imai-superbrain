import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { writeVaultConfig, isServerless } from '@/lib/vault-config'
import type { RemoteConfig, LocalConfig } from '@/lib/vault-config'
import { invalidateCache } from '@/lib/graph-cache'
import { GitHubVaultClient } from '@/lib/github'
import { GitLabVaultClient } from '@/lib/gitlab'
import type { VaultClient } from '@/lib/vault-client'

// Template files for "Start with template" option
function profileTemplate(name: string, role: string): string {
  return `---
title: Profile
type: system
---

# Profile — ${name || 'Your Name'}

${role ? `**Role:** ${role}\n\n` : ''}## Background

<!-- Describe your background, expertise, and current focus -->

## Tech Stack

<!-- List your primary tools and technologies -->

## How I Work

<!-- Describe your working style, preferences, and communication approach -->
`
}

const ACTIVE_PROJECTS_TEMPLATE = `---
title: Active Projects
type: system
---

# Active Projects

<!-- List your current projects with status and open points -->

## Project 1

**Status:** In progress

- Open point 1
- Open point 2
`

const PERSON_TEMPLATE = `---
title: "{{name}}"
type: person
tags: []
email: ""
---

# {{name}}

## Context

<!-- How do you know this person? What's their role? -->

## Notes

<!-- Key things to remember about interactions -->
`

const WELCOME_TEMPLATE = `---
title: Welcome
type: note
tags: []
---

Welcome to your Superbrain vault.

This is your personal knowledge graph. Notes are connected through [[wikilinks]] — just wrap any note title in double brackets to create a link.

## Getting started

1. Create notes in the appropriate folders (people, projects, ideas, etc.)
2. Use [[wikilinks]] to connect notes to each other
3. The graph view shows all connections between your notes
4. System files in the Claude/ folder give AI tools context about you

## Folder structure

- **people/** — person notes
- **projects/** — project notes
- **ideas/** — idea notes
- **notes/** — general notes
- **daily/** — daily notes
- **resources/** — resources and reference material
- **areas/** — areas of responsibility
- **Claude/** — system files for AI context (profile, active projects, memory)
- **templates/** — note templates
`

const TEMPLATE_FOLDERS = [
  'people',
  'projects',
  'ideas',
  'notes',
  'daily',
  'resources',
  'areas',
  'Claude',
  'Claude/memory',
  'templates',
]

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  // --- Validate connection ---
  if (action === 'validate') {
    const { provider, token, owner, repo, branch, namespace, project, url } = body

    // Local provider has no remote to validate
    if (provider === 'local') {
      return NextResponse.json({ ok: true, message: 'Local vault — no remote connection needed.' })
    }

    try {
      let client: VaultClient
      if (provider === 'gitlab') {
        if (!token || !namespace || !project) {
          return NextResponse.json({ error: 'token, namespace, and project are required' }, { status: 400 })
        }
        client = new GitLabVaultClient({ provider: 'gitlab', token, namespace, project, branch: branch || 'main', url })
      } else if (provider === 'github') {
        if (!owner || !repo || !token) {
          return NextResponse.json({ error: 'token, owner, and repo are required' }, { status: 400 })
        }
        client = new GitHubVaultClient({ pat: token, owner, repo, branch: branch || 'main' })
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
      await client.getMarkdownTree()
      const label = provider === 'gitlab' ? `${namespace}/${project}` : `${owner}/${repo}`
      return NextResponse.json({ ok: true, message: `Connected to ${label} successfully!` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (msg.includes('404') || msg.includes('Not Found')) {
        return NextResponse.json({ error: 'Repository not found. Check the name and token permissions.' }, { status: 400 })
      }
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Bad credentials')) {
        return NextResponse.json({ error: 'Invalid token. Check that it is correct and not expired.' }, { status: 400 })
      }
      return NextResponse.json({ error: `Connection failed: ${msg}` }, { status: 400 })
    }
  }

  // --- Full setup ---
  if (action === 'setup') {
    const { provider, token, owner, repo, branch, namespace, project, url, userName, userRole, vaultPath, useTemplate } = body

    // --- Local-only setup ---
    if (provider === 'local') {
      if (!vaultPath) {
        return NextResponse.json({ error: 'vaultPath is required for local provider' }, { status: 400 })
      }
      if (!isServerless()) {
        writeVaultConfig({ local: { path: vaultPath } })
      }
      invalidateCache()
      return NextResponse.json({ ok: true })
    }

    let remote: RemoteConfig
    let client: VaultClient

    if (provider === 'gitlab') {
      if (!token || !namespace || !project) {
        return NextResponse.json({ error: 'token, namespace, and project are required' }, { status: 400 })
      }
      remote = { provider: 'gitlab', token, namespace, project, branch: branch || 'main', url }
      client = new GitLabVaultClient(remote)
    } else if (provider === 'github') {
      if (!token || !owner || !repo) {
        return NextResponse.json({ error: 'token, owner, and repo are required' }, { status: 400 })
      }
      remote = { provider: 'github', token, owner, repo, branch: branch || 'main' }
      client = new GitHubVaultClient({ pat: token, owner, repo, branch: branch || 'main' })
    } else {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
    }

    try {
      const existingTree = await client.getMarkdownTree()

      // Write vault-config.json only on localhost
      if (!isServerless()) {
        const local: LocalConfig | undefined = vaultPath ? { path: vaultPath } : undefined
        writeVaultConfig({ remote, ...(local ? { local } : {}) })
      }

      // Initialize vault if empty
      if (existingTree.length === 0) {
        if (useTemplate) {
          const filesToCreate: { path: string; content: string }[] = []
          for (const folder of TEMPLATE_FOLDERS) {
            filesToCreate.push({ path: `${folder}/.gitkeep`, content: '' })
          }
          filesToCreate.push({ path: 'Claude/profile.md', content: profileTemplate(userName, userRole) })
          filesToCreate.push({ path: 'Claude/active-projects.md', content: ACTIVE_PROJECTS_TEMPLATE })
          filesToCreate.push({ path: 'templates/person.md', content: PERSON_TEMPLATE })
          filesToCreate.push({ path: 'Welcome.md', content: WELCOME_TEMPLATE })
          for (const file of filesToCreate) {
            try {
              await client.writeFile(file.path, file.content, null, `brain: setup ${file.path}`)
            } catch { /* skip if file exists */ }
          }
        } else {
          await client.writeFile('Welcome.md', WELCOME_TEMPLATE, null, 'brain: create [[Welcome]]')
        }
      }

      invalidateCache()

      // On Vercel: return the VAULT_CONFIG JSON for the user to copy
      if (isServerless()) {
        const configForCopy = { remote, ...(vaultPath ? { local: { path: vaultPath } } : {}) }
        return NextResponse.json({ ok: true, vaultConfig: JSON.stringify(configForCopy) })
      }

      return NextResponse.json({ ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
