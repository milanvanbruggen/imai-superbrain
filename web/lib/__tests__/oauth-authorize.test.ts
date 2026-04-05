// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function makeClientId(redirectUris: string[]): Promise<string> {
  const { signToken } = await import('../mcp-jwt')
  return signToken({ type: 'mcp_client', redirect_uris: redirectUris })
}

function makeAuthorizeUrl(params: Record<string, string>): string {
  const u = new URL('https://example.com/api/mcp/oauth/authorize')
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v))
  return u.toString()
}

describe('GET /api/mcp/oauth/authorize', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
  })

  it('returns 400 when code_challenge is missing', async () => {
    const clientId = await makeClientId(['https://claude.ai/callback'])
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: clientId,
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      state: 'abc',
      // no code_challenge
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when code_challenge_method is not S256', async () => {
    const clientId = await makeClientId(['https://claude.ai/callback'])
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: clientId,
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      state: 'abc',
      code_challenge: 'abc123',
      code_challenge_method: 'plain',
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 for invalid client_id JWT', async () => {
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: 'not-a-valid-jwt',
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      state: 'abc',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(400)
  })

  it('returns 400 when redirect_uri is not in client allowed list', async () => {
    const clientId = await makeClientId(['https://claude.ai/callback'])
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: clientId,
      redirect_uri: 'https://evil.com/steal',
      response_type: 'code',
      state: 'abc',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(400)
  })

  it('redirects to login when no session', async () => {
    // vi.doMock (not vi.mock) is used here because we're inside a callback — it is NOT hoisted.
    // It must be called before the dynamic import of the route that depends on next-auth/next.
    vi.doMock('next-auth/next', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }))
    const clientId = await makeClientId(['https://claude.ai/callback'])
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: clientId,
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      state: 'abc',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login')
    expect(res.headers.get('location')).toContain('callbackUrl')
  })

  it('issues code and redirects to redirect_uri when session is present', async () => {
    vi.doMock('next-auth/next', () => ({
      getServerSession: vi.fn().mockResolvedValue({ user: { email: 'test@example.com' } }),
    }))
    const clientId = await makeClientId(['https://claude.ai/callback'])
    const { GET } = await import('../../app/api/mcp/oauth/authorize/route')
    const url = makeAuthorizeUrl({
      client_id: clientId,
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      state: 'my-state',
      code_challenge: 'abc123',
      code_challenge_method: 'S256',
    })
    const res = await GET(new Request(url))
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://claude.ai/callback')
    expect(location).toContain('code=')
    expect(location).toContain('state=my-state')
  })
})
