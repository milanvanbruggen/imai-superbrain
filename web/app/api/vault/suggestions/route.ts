import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-utils'
import { getVaultClient } from '@/lib/vault-client'
import { readSuggestionStore, writeSuggestionStore } from '@/lib/suggestions'
import { readVaultPreferences } from '@/lib/vault-preferences'

export async function GET() {
  return withAuth(async () => {
    let client
    try {
      client = getVaultClient()
    } catch {
      return NextResponse.json({ error: 'vault_not_configured' }, { status: 422 })
    }
    const [{ store }, { prefs }] = await Promise.all([readSuggestionStore(client), readVaultPreferences(client)])
    return NextResponse.json({
      lastRunAt: store.lastRunAt,
      suggestions: store.suggestions.filter(s => s.status === 'pending'),
      unlinked: store.unlinked ?? [],
      ownerNote: prefs.ownerNote ?? null,
    })
  })
}

// Record the owner's decision; the actual merge or relation is done through the existing routes
export async function PATCH(req: NextRequest) {
  return withAuth(async () => {
    const { id, status } = await req.json()
    if (typeof id !== 'string' || (status !== 'accepted' && status !== 'dismissed')) {
      return NextResponse.json({ error: 'id and status (accepted | dismissed) required' }, { status: 400 })
    }
    const client = getVaultClient()
    const { store, sha } = await readSuggestionStore(client)
    const suggestion = store.suggestions.find(s => s.id === id)
    if (!suggestion) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    suggestion.status = status
    await writeSuggestionStore(client, store, sha, `brain: ${status} AI suggestion`)
    return NextResponse.json({ ok: true })
  })
}
