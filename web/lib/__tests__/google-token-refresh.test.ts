import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshGoogleToken } from '../google-token-refresh'

describe('refreshGoogleToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns new token fields on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        expires_in: 3600,
      }),
    } as Response)

    const result = await refreshGoogleToken('old-refresh-token')
    expect(result.google_access_token).toBe('new-access')
    expect(result.google_error).toBeUndefined()
  })

  it('returns error flag on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response)

    const result = await refreshGoogleToken('bad-refresh-token')
    expect(result.google_error).toBe('RefreshTokenError')
  })
})
