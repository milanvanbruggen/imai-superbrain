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
})
