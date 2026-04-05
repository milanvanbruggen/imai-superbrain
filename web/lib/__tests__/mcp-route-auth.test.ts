// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// Mock vault client so the route doesn't try to read real files
vi.mock('@/lib/vault-client', () => ({
  getVaultClient: () => ({
    getMarkdownTree: async () => [],
    readFile: async () => ({ content: '', sha: null }),
    writeFile: async () => {},
  }),
}))
vi.mock('@/lib/vault-parser', () => ({
  buildGraph: () => ({ nodes: [], edges: [], notesByStem: {} }),
}))

async function makeAccessToken(): Promise<string> {
  const { signToken } = await import('../mcp-jwt')
  return signToken({ type: 'mcp_access', sub: 'user1', client_id: 'test' }, '30d')
}

describe('POST /api/mcp — auth', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
  })

  it('returns 401 when no Authorization header', async () => {
    const { POST } = await import('../../app/api/mcp/route')
    const req = new Request('https://example.com/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 for invalid token', async () => {
    const { POST } = await import('../../app/api/mcp/route')
    const req = new Request('https://example.com/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not-a-valid-jwt',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('accepts a valid access token', async () => {
    const token = await makeAccessToken()
    const { POST } = await import('../../app/api/mcp/route')
    const req = new Request('https://example.com/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }),
    })
    // We only care that the request is not rejected with 401
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })
})
