import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'
import { invalidateCache } from '@/lib/graph-cache'

const WELCOME_NOTE = `---
title: Welcome
type: note
tags: []
---

Welcome to your Superbrain vault.

This is your first note. You can edit or delete it, and create new notes from the app.
`

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = getVaultClient()

    // Check if vault already has notes
    const tree = await client.getMarkdownTree()
    if (tree.length > 0) {
      return NextResponse.json({ error: 'Vault already has notes' }, { status: 409 })
    }

    await client.writeFile('Welcome.md', WELCOME_NOTE, null, 'brain: create [[Welcome]]')
    invalidateCache()
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
