// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/mcp/oauth/register', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
  })

  it('returns client_id and RFC 7591 fields for valid input', async () => {
    const { POST } = await import('../../app/api/mcp/oauth/register/route')
    const req = new Request('https://example.com/api/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://claude.ai/callback'] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.client_id).toBe('string')
    expect(body.redirect_uris).toEqual(['https://claude.ai/callback'])
    expect(body.token_endpoint_auth_method).toBe('none')
    expect(body.grant_types).toContain('authorization_code')
    expect(body.response_types).toContain('code')
  })

  it('returns 400 when redirect_uris is missing', async () => {
    const { POST } = await import('../../app/api/mcp/oauth/register/route')
    const req = new Request('https://example.com/api/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when redirect_uris is empty', async () => {
    const { POST } = await import('../../app/api/mcp/oauth/register/route')
    const req = new Request('https://example.com/api/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [] }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
