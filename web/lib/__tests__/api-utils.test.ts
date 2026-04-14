// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }))

import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { withAuth } from '../api-utils'

describe('withAuth', () => {
  it('returns 401 when session is null', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null)
    const handler = vi.fn()
    const res = await withAuth(handler)
    expect(handler).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
    expect(res.status).toBe(401)
  })

  it('calls handler with session when authenticated', async () => {
    const fakeSession = { user: { email: 'test@test.com' } }
    vi.mocked(getServerSession).mockResolvedValueOnce(fakeSession as any)
    const mockResponse = NextResponse.json({ ok: true })
    const handler = vi.fn().mockResolvedValue(mockResponse)
    const result = await withAuth(handler)
    expect(handler).toHaveBeenCalledWith(fakeSession)
    expect(result).toBe(mockResponse)
  })
})
