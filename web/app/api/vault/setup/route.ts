import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { writeVaultConfig, isServerless } from '@/lib/vault-config'
import { invalidateCache } from '@/lib/graph-cache'
import { GitHubVaultClient } from '@/lib/github'

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

  // --- Validate GitHub connection ---
  if (action === 'validate') {
    const { owner, repo, branch, pat } = body
    if (!owner || !repo || !pat) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    try {
      const client = new GitHubVaultClient({ pat, owner, repo, branch: branch || 'main' })
      // Try to access the repo (this will throw if PAT is invalid or repo doesn't exist)
      await client.getMarkdownTree()
      return NextResponse.json({ ok: true, message: `Connected to ${owner}/${repo} successfully!` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      if (msg.includes('404') || msg.includes('Not Found')) {
        return NextResponse.json({ error: `Repository "${owner}/${repo}" not found. Make sure it exists and the PAT has access.` }, { status: 400 })
      }
      if (msg.includes('401') || msg.includes('Bad credentials')) {
        return NextResponse.json({ error: 'Invalid PAT. Check that the token is correct and not expired.' }, { status: 400 })
      }
      return NextResponse.json({ error: `Connection failed: ${msg}` }, { status: 400 })
    }
  }

  // --- Full setup ---
  if (action === 'setup') {
    const { owner, repo, branch, pat, userName, userRole, vaultPath, useTemplate } = body
    if (!owner || !repo || !pat) {
      return NextResponse.json({ error: 'GitHub owner, repo, and PAT are required' }, { status: 400 })
    }

    try {
      // 1. Validate connection first
      const client = new GitHubVaultClient({ pat, owner, repo, branch: branch || 'main' })
      const existingTree = await client.getMarkdownTree()

      // 2. Write vault-config.json (only on localhost)
      if (!isServerless()) {
        const configPayload: Record<string, string> = {
          mode: vaultPath ? 'local' : 'github',
          owner,
          repo,
          branch: branch || 'main',
        }
        if (vaultPath) configPayload.vaultPath = vaultPath
        writeVaultConfig(configPayload as any)
      }

      // 3. Initialize vault if empty
      if (existingTree.length === 0) {
        if (useTemplate) {
          // Create folder structure via .gitkeep files + system files
          const filesToCreate: { path: string; content: string }[] = []

          // Folder .gitkeep files
          for (const folder of TEMPLATE_FOLDERS) {
            filesToCreate.push({ path: `${folder}/.gitkeep`, content: '' })
          }

          // System files
          filesToCreate.push({ path: 'Claude/profile.md', content: profileTemplate(userName, userRole) })
          filesToCreate.push({ path: 'Claude/active-projects.md', content: ACTIVE_PROJECTS_TEMPLATE })
          filesToCreate.push({ path: 'templates/person.md', content: PERSON_TEMPLATE })
          filesToCreate.push({ path: 'Welcome.md', content: WELCOME_TEMPLATE })

          // Write all files
          for (const file of filesToCreate) {
            try {
              await client.writeFile(file.path, file.content, null, `brain: setup ${file.path}`)
            } catch {
              // Skip if file already exists
            }
          }
        } else {
          // Fresh start — just a welcome note
          await client.writeFile('Welcome.md', WELCOME_TEMPLATE, null, 'brain: create [[Welcome]]')
        }
      }

      invalidateCache()
      return NextResponse.json({ ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
