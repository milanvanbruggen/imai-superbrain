import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-utils'
import { getVaultClient } from '@/lib/vault-client'
import { readVaultPreferences, writeVaultPreferences } from '@/lib/vault-preferences'

export async function GET() {
  return withAuth(async () => {
    try {
      const { prefs } = await readVaultPreferences(getVaultClient())
      return NextResponse.json(prefs)
    } catch {
      return NextResponse.json({ error: 'vault_not_configured' }, { status: 422 })
    }
  })
}

// Body: { ownerNote: string | null }
export async function PUT(req: NextRequest) {
  return withAuth(async () => {
    const { ownerNote } = await req.json()
    if (ownerNote !== null && (typeof ownerNote !== 'string' || !ownerNote.endsWith('.md'))) {
      return NextResponse.json({ error: 'ownerNote must be a note path or null' }, { status: 400 })
    }
    const client = getVaultClient()
    if (ownerNote) {
      try {
        await client.readFile(ownerNote)
      } catch {
        return NextResponse.json({ error: `Note not found: ${ownerNote}` }, { status: 404 })
      }
    }
    const { prefs, sha } = await readVaultPreferences(client)
    const next = { ...prefs }
    if (ownerNote) next.ownerNote = ownerNote
    else delete next.ownerNote
    await writeVaultPreferences(client, next, sha)
    return NextResponse.json(next)
  })
}
