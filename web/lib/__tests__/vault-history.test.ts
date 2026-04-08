import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listCommits, restoreToCommit } from '../vault-history'

const fetchMock = vi.fn()
global.fetch = fetchMock

const creds = { pat: 'token', owner: 'milan', repo: 'vault', branch: 'main' }

beforeEach(() => fetchMock.mockReset())

describe('listCommits', () => {
  it('returns mapped commit entries', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        {
          sha: 'abc1234567890abcdef1234567890abcdef123456',
          commit: { message: 'brain: update [[Note]]\n\nDetails', author: { date: '2026-04-08T10:00:00Z' } },
        },
        {
          sha: 'def9876543210def9876543210def9876543210d',
          commit: { message: 'brain: create [[Other]]', author: { date: '2026-04-07T09:00:00Z' } },
        },
      ]),
    })

    const commits = await listCommits(creds)

    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({
      sha: 'abc1234567890abcdef1234567890abcdef123456',
      shortSha: 'abc1234',
      message: 'brain: update [[Note]]',
      date: '2026-04-08T10:00:00Z',
    })
    expect(commits[1].shortSha).toBe('def9876')
  })

  it('throws on non-ok GitHub response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    await expect(listCommits(creds)).rejects.toThrow('401')
  })
})

describe('restoreToCommit', () => {
  it('calls GitHub Git Data API in the correct order', async () => {
    // 1. Get target commit (tree sha)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: { sha: 'tree-sha-old' } }),
    })
    // 2. Get current HEAD ref
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'head-sha-current' } }),
    })
    // 3. Create new commit
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'new-commit-sha' }),
    })
    // 4. Update branch ref
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    await restoreToCommit(creds, 'abc1234567890abcdef1234567890abcdef123456')

    expect(fetchMock).toHaveBeenCalledTimes(4)

    // Step 3: create commit with old tree + current head as parent
    const createCommitCall = fetchMock.mock.calls[2]
    const body = JSON.parse(createCommitCall[1].body)
    expect(body.tree).toBe('tree-sha-old')
    expect(body.parents).toEqual(['head-sha-current'])
    expect(body.message).toBe('restore: revert to abc1234')

    // Step 4: update ref to new commit sha
    const updateRefCall = fetchMock.mock.calls[3]
    const refBody = JSON.parse(updateRefCall[1].body)
    expect(refBody.sha).toBe('new-commit-sha')
  })

  it('throws when creating the new commit fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ tree: { sha: 'tree' } }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ object: { sha: 'head' } }) })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}) })

    await expect(restoreToCommit(creds, 'abc1234567890abcdef1234567890abcdef123456')).rejects.toThrow('422')
  })
})
