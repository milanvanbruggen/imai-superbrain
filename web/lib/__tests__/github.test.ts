import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubVaultClient } from '../github'

const fetchMock = vi.fn()
global.fetch = fetchMock

const client = new GitHubVaultClient({
  pat: 'test-token',
  owner: 'milan',
  repo: 'vault',
})

beforeEach(() => fetchMock.mockReset())

describe('GitHubVaultClient', () => {
  it('fetches file tree recursively — branch endpoint called first', async () => {
    // Branch endpoint is called first
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ commit: { sha: 'abc123' } }),
    })
    // Then the recursive tree endpoint
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sha: 'abc123',
        tree: [
          { path: 'notes/hello.md', type: 'blob', sha: 'def456' },
          { path: 'people/Milan.md', type: 'blob', sha: 'ghi789' },
          { path: 'images', type: 'tree', sha: 'jkl012' },
        ],
      }),
    })

    const tree = await client.getMarkdownTree()
    expect(tree).toHaveLength(2)
    expect(tree.every(f => f.path.endsWith('.md'))).toBe(true)
  })

  it('reads a file and decodes base64 content', async () => {
    const content = '# Hello World'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from(content).toString('base64') + '\n',
        sha: 'filesha123',
      }),
    })

    const result = await client.readFile('notes/hello.md')
    expect(result.content).toBe(content)
    expect(result.sha).toBe('filesha123')
  })

  it('writes a file with a commit message', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.writeFile('notes/hello.md', '# Updated', 'filesha123', 'brain: update [[hello]]')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('notes/hello.md'),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('throws on non-ok responses from readFile', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    })

    await expect(client.readFile('notes/missing.md')).rejects.toThrow('404')
  })

  it('sends If-None-Match and reuses the cached body on 304', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: 'W/"etag-1"' }),
      json: async () => ({ content: Buffer.from('# Cached').toString('base64'), sha: 'sha-1' }),
    })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 304, headers: new Headers() })

    await client.readFile('notes/cached.md')
    const second = await client.readFile('notes/cached.md')

    expect(second).toEqual({ content: '# Cached', sha: 'sha-1' })
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('W/"etag-1"')
  })

  it('includes the rate-limit reset time when GitHub refuses with 403', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
      json: async () => ({ message: 'API rate limit exceeded for user ID 1.' }),
    })

    await expect(client.getMarkdownTree()).rejects.toThrow(
      'Failed to get branch: 403 (GitHub API rate limit exceeded, resets at 22:13 UTC)'
    )
  })

  it('passes through GitHub\'s message for other 403s', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '4999' }),
      json: async () => ({ message: 'Resource not accessible by personal access token' }),
    })

    await expect(client.getMarkdownTree()).rejects.toThrow(
      'Failed to get branch: 403 (Resource not accessible by personal access token)'
    )
  })
})
