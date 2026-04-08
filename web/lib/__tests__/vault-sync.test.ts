import { describe, it, expect } from 'vitest'
import { computeSyncActions } from '../vault-sync'

describe('computeSyncActions', () => {
  it('returns empty actions when nothing changed', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local = [{ path: 'a.md', sha: 'sha1' }]
    const remote = [{ path: 'a.md', sha: 'sha1' }]
    expect(computeSyncActions(local, remote, snapshot)).toEqual([])
  })

  it('pushes locally changed file to remote', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'new' }]
    const remote = [{ path: 'a.md', sha: 'old' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'a.md' }])
  })

  it('pulls remotely changed file to local', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'old' }]
    const remote = [{ path: 'a.md', sha: 'new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'a.md' }])
  })

  it('detects conflict when both sides changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'local-new' }]
    const remote = [{ path: 'a.md', sha: 'remote-new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'conflict', path: 'a.md' }])
  })

  it('pushes new local file', () => {
    const snapshot = {}
    const local = [{ path: 'new.md', sha: 'abc' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'new.md' }])
  })

  it('pulls new remote file', () => {
    const snapshot = {}
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'new.md', sha: 'abc' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'new.md' }])
  })

  it('deletes remote when local deleted and remote unchanged', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'a.md', sha: 'sha1' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'delete-remote', path: 'a.md' }])
  })

  it('deletes local when remote deleted and local unchanged', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local = [{ path: 'a.md', sha: 'sha1' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'delete-local', path: 'a.md' }])
  })

  it('pulls when local deleted but remote was changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local: { path: string; sha: string }[] = []
    const remote = [{ path: 'a.md', sha: 'new' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'pull', path: 'a.md' }])
  })

  it('pushes when remote deleted but local was changed', () => {
    const snapshot = { 'a.md': 'old' }
    const local = [{ path: 'a.md', sha: 'new' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'push', path: 'a.md' }])
  })

  it('skips both deleted (was in snapshot, now gone from both)', () => {
    const snapshot = { 'a.md': 'sha1' }
    const local: { path: string; sha: string }[] = []
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })

  it('skips new file that exists on both sides with same SHA', () => {
    const snapshot = {}
    const local = [{ path: 'a.md', sha: 'same' }]
    const remote = [{ path: 'a.md', sha: 'same' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })

  it('marks conflict for new file on both sides with different SHA', () => {
    const snapshot = {}
    const local = [{ path: 'a.md', sha: 'local' }]
    const remote = [{ path: 'a.md', sha: 'remote' }]
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([{ type: 'conflict', path: 'a.md' }])
  })

  it('excludes .conflict.md files from actions', () => {
    const snapshot = {}
    const local = [{ path: 'a.conflict.md', sha: 'abc' }]
    const remote: { path: string; sha: string }[] = []
    const actions = computeSyncActions(local, remote, snapshot)
    expect(actions).toEqual([])
  })
})
