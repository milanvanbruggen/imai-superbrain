// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns all required RFC 8414 fields', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
    const { GET } = await import('../../app/.well-known/oauth-authorization-server/route')
    const res = await GET()
    const body = await res.json()

    expect(body.issuer).toBe('https://example.com')
    expect(body.authorization_endpoint).toContain('/api/mcp/oauth/authorize')
    expect(body.token_endpoint).toContain('/api/mcp/oauth/token')
    expect(body.registration_endpoint).toContain('/api/mcp/oauth/register')
    expect(body.response_types_supported).toContain('code')
    expect(body.grant_types_supported).toContain('authorization_code')
    expect(body.code_challenge_methods_supported).toContain('S256')
    expect(body.token_endpoint_auth_methods_supported).toContain('none')
  })
})
