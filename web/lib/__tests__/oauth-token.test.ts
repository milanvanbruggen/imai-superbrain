// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createHash } from 'crypto'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function makeAuthCode(overrides: Record<string, unknown> = {}): Promise<string> {
  const { signToken } = await import('../mcp-jwt')
  return signToken(
    {
      type: 'mcp_code',
      sub: 'user1',
      client_id: 'client-jwt-placeholder',
      redirect_uri: 'https://claude.ai/callback',
      code_challenge: createHash('sha256').update('my-verifier').digest('base64url'),
      code_challenge_method: 'S256',
      ...overrides,
    },
    '5m'
  )
}

function makeTokenRequest(params: Record<string, string>): Request {
  return new Request('https://example.com/api/mcp/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
}

describe('POST /api/mcp/oauth/token', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
  })

  it('returns access token for valid code + verifier', async () => {
    const code = await makeAuthCode()
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'my-verifier',
        client_id: 'client-jwt-placeholder',
        redirect_uri: 'https://claude.ai/callback',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.access_token).toBe('string')
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(2592000)
  })

  it('returns 400 invalid_grant for wrong code_verifier', async () => {
    const code = await makeAuthCode()
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier',
        client_id: 'client-jwt-placeholder',
        redirect_uri: 'https://claude.ai/callback',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_grant')
  })

  it('returns 400 invalid_grant for redirect_uri mismatch', async () => {
    const code = await makeAuthCode()
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'my-verifier',
        client_id: 'client-jwt-placeholder',
        redirect_uri: 'https://evil.com/steal',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_grant')
  })

  it('returns 400 invalid_grant for client_id mismatch', async () => {
    const code = await makeAuthCode({ client_id: 'original-client' })
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'my-verifier',
        client_id: 'attacker-client',
        redirect_uri: 'https://claude.ai/callback',
      })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_grant')
  })

  it('returns 400 invalid_grant for expired code', async () => {
    const { signToken } = await import('../mcp-jwt')
    const { createHash } = await import('crypto')
    // jose rounds expiry to seconds; use '1s' and wait for it to expire
    const code = await signToken(
      {
        type: 'mcp_code',
        sub: 'user1',
        client_id: 'client-jwt-placeholder',
        redirect_uri: 'https://claude.ai/callback',
        code_challenge: createHash('sha256').update('my-verifier').digest('base64url'),
        code_challenge_method: 'S256',
      },
      '1s'
    )
    await new Promise(r => setTimeout(r, 1100))
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'my-verifier',
        client_id: 'client-jwt-placeholder',
        redirect_uri: 'https://claude.ai/callback',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')
  }, 5000)

  it('returns 400 for unsupported grant_type', async () => {
    const { POST } = await import('../../app/api/mcp/oauth/token/route')
    const res = await POST(
      makeTokenRequest({ grant_type: 'client_credentials' })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unsupported_grant_type')
  })
})
