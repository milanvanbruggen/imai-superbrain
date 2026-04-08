import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitLabVaultClient } from '../gitlab'

const fetchMock = vi.fn()
global.fetch = fetchMock

const client = new GitLabVaultClient({
  provider: 'gitlab',
  token: 'glpat-test',
  namespace: 'mygroup',
  project: 'myvault',
  branch: 'main',
  url: 'https://gitlab.example.com',
})

beforeEach(() => fetchMock.mockReset())

describe('GitLabVaultClient', () => {
  it('fetches markdown tree via paginated tree endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { path: 'notes/hello.md', type: 'blob', id: 'sha1' },
        { path: 'people/Alice.md', type: 'blob', id: 'sha2' },
        { path: 'images/photo.png', type: 'blob', id: 'sha3' },
        { path: 'archive/old.md', type: 'blob', id: 'sha4' },
      ]),
    })

    const tree = await client.getMarkdownTree()
    expect(tree).toHaveLength(2)
    expect(tree[0]).toEqual({ path: 'notes/hello.md', sha: 'sha1' })
    expect(tree[1]).toEqual({ path: 'people/Alice.md', sha: 'sha2' })
  })

  it('reads a file and decodes base64 content', async () => {
    const content = '# Hello World'
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from(content).toString('base64'),
        blob_id: 'filesha123',
      }),
    })

    const result = await client.readFile('notes/hello.md')
    expect(result.content).toBe(content)
    expect(result.sha).toBe('filesha123')
  })

  it('creates a new file with POST when sha is null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.writeFile('notes/new.md', '# New', null, 'brain: create [[new]]')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('notes%2Fnew.md'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('updates a file with PUT when sha is provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.writeFile('notes/hello.md', '# Updated', 'existingsha', 'brain: update [[hello]]')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('notes%2Fhello.md'),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('deletes a file', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await client.deleteFile('notes/hello.md', 'sha123', 'brain: delete [[hello]]')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('notes%2Fhello.md'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('throws on non-ok readFile response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })

    await expect(client.readFile('notes/missing.md')).rejects.toThrow('404')
  })

  it('uses https://gitlab.com as default url when url is omitted', async () => {
    const { GitLabVaultClient } = await import('../gitlab')
    const defaultClient = new GitLabVaultClient({
      provider: 'gitlab',
      token: 'tok',
      namespace: 'ns',
      project: 'proj',
    })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ([]) })
    await defaultClient.getMarkdownTree()
    expect(fetchMock.mock.calls[0][0]).toContain('https://gitlab.com')
  })
})
