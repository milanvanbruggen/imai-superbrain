// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getIssuer', () => {
  it('returns NEXTAUTH_URL when set', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
    const { getIssuer } = await import('../mcp-jwt')
    expect(getIssuer()).toBe('https://example.com')
  })

  it('returns fallback when NEXTAUTH_URL is not set', async () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    const { getIssuer } = await import('../mcp-jwt')
    expect(getIssuer()).toBe('https://mai-superbrain-web.vercel.app')
  })
})

describe('signToken / verifyToken', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-chars-long!!')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')
  })

  it('signs a token and verifies it back', async () => {
    const { signToken, verifyToken } = await import('../mcp-jwt')
    const token = await signToken({ type: 'mcp_access', sub: 'user1' })
    expect(typeof token).toBe('string')
    const payload = await verifyToken(token, 'mcp_access')
    expect(payload.sub).toBe('user1')
    expect(payload.type).toBe('mcp_access')
  })

  it('throws for wrong type', async () => {
    const { signToken, verifyToken } = await import('../mcp-jwt')
    const token = await signToken({ type: 'mcp_code', sub: 'user1' }, '5m')
    await expect(verifyToken(token, 'mcp_access')).rejects.toThrow()
  })

  it('throws for expired token', async () => {
    const { signToken, verifyToken } = await import('../mcp-jwt')
    // jose rounds to seconds; use '1s' and wait for it to expire
    const token = await signToken({ type: 'mcp_access', sub: 'user1' }, '1s')
    await new Promise(r => setTimeout(r, 1100))
    await expect(verifyToken(token, 'mcp_access')).rejects.toThrow()
  }, 5000)

  it('throws when NEXTAUTH_SECRET is missing', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', '')
    const { signToken } = await import('../mcp-jwt')
    await expect(signToken({ type: 'mcp_access' })).rejects.toThrow()
  })
})

describe('verifyPKCE', () => {
  it('returns true for a valid S256 verifier/challenge pair', async () => {
    const { verifyPKCE } = await import('../mcp-jwt')
    const verifier = 'abc'
    const { createHash } = await import('crypto')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(await verifyPKCE(verifier, challenge)).toBe(true)
  })

  it('returns false for a wrong verifier', async () => {
    const { verifyPKCE } = await import('../mcp-jwt')
    const { createHash } = await import('crypto')
    const challenge = createHash('sha256').update('correct').digest('base64url')
    expect(await verifyPKCE('wrong', challenge)).toBe(false)
  })
})
