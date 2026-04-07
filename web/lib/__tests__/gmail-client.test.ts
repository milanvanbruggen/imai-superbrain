import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildGmailQuery, sanitizeQueryTerm, listMessages } from '../gmail-client'

describe('sanitizeQueryTerm', () => {
  it('strips Gmail search operators from input', () => {
    expect(sanitizeQueryTerm('foo(bar):baz"qux')).toBe('foobarbazqux')
  })

  it('preserves normal alphanumeric and spaces', () => {
    expect(sanitizeQueryTerm('Milan van Bruggen')).toBe('Milan van Bruggen')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeQueryTerm('')).toBe('')
  })
})

describe('buildGmailQuery', () => {
  it('builds query with name only', () => {
    expect(buildGmailQuery('Milan van Bruggen', undefined)).toBe('"Milan van Bruggen"')
  })

  it('builds query with name and email', () => {
    expect(buildGmailQuery('Milan van Bruggen', 'milan@example.com')).toBe('"Milan van Bruggen" OR "milan@example.com"')
  })

  it('sanitizes inputs before building', () => {
    expect(buildGmailQuery('Foo:Bar', 'a"b@x.com')).toBe('"FooBar" OR "ab@x.com"')
  })
})

describe('listMessages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ids and nextPageToken when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{ id: 'abc' }, { id: 'def' }],
        nextPageToken: 'token123',
      }),
    }))
    const result = await listMessages('tok', '"test"')
    expect(result.ids).toEqual(['abc', 'def'])
    expect(result.nextPageToken).toBe('token123')
  })

  it('returns empty ids and no nextPageToken when no messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [] }),
    }))
    const result = await listMessages('tok', '"test"')
    expect(result.ids).toEqual([])
    expect(result.nextPageToken).toBeUndefined()
  })

  it('appends pageToken to URL when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    await listMessages('tok', '"test"', 20, 'myToken')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('pageToken=myToken')
  })

  it('throws with status 429 on rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(listMessages('tok', '"test"')).rejects.toMatchObject({ status: 429 })
  })
})
