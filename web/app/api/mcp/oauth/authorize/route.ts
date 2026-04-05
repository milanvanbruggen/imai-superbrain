import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { signToken, verifyToken, getIssuer } from '@/lib/mcp-jwt'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = url.searchParams

  const clientIdToken = p.get('client_id') ?? ''
  const redirectUri = p.get('redirect_uri') ?? ''
  const codeChallenge = p.get('code_challenge') ?? ''
  const codeChallengeMethod = p.get('code_challenge_method') ?? ''
  const state = p.get('state') ?? undefined
  const responseType = p.get('response_type') ?? ''

  // Validate response_type
  if (responseType !== 'code') {
    return NextResponse.json({ error: 'unsupported_response_type' }, { status: 400 })
  }

  // Require PKCE S256
  if (!codeChallenge) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'code_challenge is required' },
      { status: 400 }
    )
  }
  if (codeChallengeMethod !== 'S256') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'only S256 code_challenge_method is supported' },
      { status: 400 }
    )
  }

  // Validate client_id JWT
  let clientPayload: Record<string, unknown>
  try {
    clientPayload = await verifyToken(clientIdToken, 'mcp_client')
  } catch {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  }

  // Validate redirect_uri
  const allowedUris = clientPayload['redirect_uris']
  if (!Array.isArray(allowedUris) || !allowedUris.includes(redirectUri)) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri not registered' },
      { status: 400 }
    )
  }

  // Check session
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    const issuer = getIssuer()
    const callbackUrl = encodeURIComponent(req.url)
    return NextResponse.redirect(`${issuer}/login?callbackUrl=${callbackUrl}`, { status: 302 })
  }

  // Issue auth code
  const code = await signToken(
    {
      type: 'mcp_code',
      sub: session.user.email ?? session.user.name ?? 'user',
      client_id: clientIdToken,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    },
    '5m'
  )

  // Redirect to redirect_uri with code (and state if present)
  const dest = new URL(redirectUri)
  dest.searchParams.set('code', code)
  if (state) dest.searchParams.set('state', state)
  return NextResponse.redirect(dest.toString(), { status: 302 })
}
