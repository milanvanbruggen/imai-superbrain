import { NextResponse } from 'next/server'
import { signToken, verifyToken, verifyPKCE } from '@/lib/mcp-jwt'

export async function POST(req: Request) {
  // Parse form-encoded body (standard OAuth token request)
  let params: URLSearchParams
  try {
    const text = await req.text()
    params = new URLSearchParams(text)
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const grantType = params.get('grant_type') ?? ''
  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 })
  }

  const code = params.get('code') ?? ''
  const codeVerifier = params.get('code_verifier') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const clientId = params.get('client_id') ?? ''

  // Verify auth code JWT
  let codePayload: Record<string, unknown>
  try {
    codePayload = await verifyToken(code, 'mcp_code')
  } catch {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  // Validate redirect_uri exact-match (RFC 6749 §4.1.3)
  if (codePayload['redirect_uri'] !== redirectUri) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  // Validate client_id matches
  if (codePayload['client_id'] !== clientId) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  // Verify PKCE — reject explicitly if verifier is missing (RFC 7636 §4.5)
  if (!codeVerifier) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }
  const challenge = codePayload['code_challenge'] as string
  const valid = await verifyPKCE(codeVerifier, challenge)
  if (!valid) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  // Issue access token (30 days)
  const accessToken = await signToken(
    {
      type: 'mcp_access',
      sub: codePayload['sub'] as string,
      client_id: clientId,
    },
    '30d'
  )

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 60 * 60 * 24 * 30, // 30 days in seconds
  })
}
