import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken } from '@/lib/google-auth'
import { getMessageBody } from '@/lib/gmail-client'
import { getVaultClient } from '@/lib/vault-client'
import Anthropic from '@anthropic-ai/sdk'

const MAX_IDS = 10
const MAX_CHARS = 50_000
const EMAIL_CONTEXT_MARKER = '\n\n## Email context\n\n'

// Exported for testing
export function extractEmailContext(content: string): string | null {
  const markerIdx = content.indexOf(EMAIL_CONTEXT_MARKER)
  if (markerIdx === -1) return null
  const start = markerIdx + EMAIL_CONTEXT_MARKER.length
  const nextHeading = content.indexOf('\n\n##', start)
  const end = nextHeading === -1 ? content.length : nextHeading
  const extracted = content.slice(start, end).trim()
  return extracted.length > 0 ? extracted : null
}

export async function POST(req: NextRequest) {
  const tokenResult = await getGoogleAccessToken(req)
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.status })
  }

  const { messageIds, personName, path } = await req.json()
  const safeName = typeof personName === 'string'
    ? personName.slice(0, 200)
    : 'deze persoon'
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: 'messageIds is required' }, { status: 400 })
  }

  if (!messageIds.every((id: unknown) => typeof id === 'string')) {
    return NextResponse.json({ error: 'messageIds must be strings' }, { status: 400 })
  }

  const ids = messageIds.slice(0, MAX_IDS)

  // Fetch bodies (skip 404s)
  const bodyResults = await Promise.allSettled(
    ids.map(id => getMessageBody(tokenResult.accessToken, id))
  )

  const bodies = bodyResults
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value as string)

  if (bodies.length === 0) {
    return NextResponse.json({ error: 'no_messages' }, { status: 422 })
  }

  // Truncate total content
  const emailContent = bodies.join('\n\n---\n\n').slice(0, MAX_CHARS)

  // Read existing email context from note (best-effort — failures silently ignored)
  let existingContext: string | null = null
  if (typeof path === 'string' && path.endsWith('.md') && !path.includes('..')) {
    try {
      const vaultClient = getVaultClient()
      const { content: noteContent } = await vaultClient.readFile(path)
      existingContext = extractEmailContext(noteContent)
    } catch {
      // Silently ignore — proceed without existing context
    }
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let summary: string
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: existingContext
            ? `Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staat de bestaande context over ${safeName}, gevolgd door ${bodies.length} nieuwe e-mails. Schrijf één beknopte, samenhangende contextparagraaf in markdown die de bestaande context integreert met de nieuwe informatie. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

Bestaande context:
${existingContext}

Nieuwe e-mails:
${emailContent}`
            : `Je bent een assistent die helpt een persoonlijk kennisbeheersysteem bij te houden.

Hieronder staan ${bodies.length} e-mails die gerelateerd zijn aan ${safeName}. Schrijf een beknopte contextparagraaf in markdown die toegevoegd kan worden aan de notitie over deze persoon. Focus op:
- Wat is de aard van het contact?
- Welke projecten of onderwerpen zijn besproken?
- Relevante afspraken, acties of besluiten?

Schrijf geen opsomming van emails. Schrijf een vloeiende paragraaf, maximaal 150 woorden. Begin direct met de inhoud (geen "Hier is de samenvatting:" of vergelijkbaar).

E-mails:
${emailContent}`,
        },
      ],
    })

    summary = (message.content[0] as any).text ?? ''
  } catch {
    return NextResponse.json({ error: 'Claude API error' }, { status: 502 })
  }

  return NextResponse.json({ summary })
}
