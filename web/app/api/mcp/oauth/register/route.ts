import { NextResponse } from 'next/server'
import { signToken } from '@/lib/mcp-jwt'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { redirect_uris } = body as { redirect_uris?: string[] }
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' },
      { status: 400 }
    )
  }

  const clientId = await signToken({ type: 'mcp_client', redirect_uris })

  return NextResponse.json(
    {
      client_id: clientId,
      redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 }
  )
}
