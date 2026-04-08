import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computeSyncActions, readSnapshot, writeSnapshot, executeSync } from '../vault-sync'
import { LocalVaultClient } from '../local'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

describe('readSnapshot / writeSnapshot', () => {
  const dir = join(tmpdir(), `sync-snap-${Date.now()}`)

  beforeEach(() => mkdirSync(dir, { recursive: true }))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns empty snapshot when file does not exist', () => {
    const snap = readSnapshot(join(dir, 'nonexistent.json'))
    expect(snap).toEqual({ lastSync: '', files: {} })
  })

  it('round-trips snapshot data', () => {
    const path = join(dir, 'state.json')
    const data = { lastSync: '2026-01-01T00:00:00Z', files: { 'a.md': 'sha1' } }
    writeSnapshot(path, data)
    expect(readSnapshot(path)).toEqual(data)
  })
})

describe('executeSync', () => {
  let localDir: string
  let remoteDir: string
  let snapshotPath: string

  beforeEach(() => {
    const base = join(tmpdir(), `sync-exec-${Date.now()}`)
    localDir = join(base, 'local')
    remoteDir = join(base, 'remote')
    snapshotPath = join(base, 'sync-state.json')
    mkdirSync(localDir, { recursive: true })
    mkdirSync(remoteDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(join(localDir, '..'), { recursive: true, force: true })
  })

  it('first sync creates snapshot without actions', async () => {
    writeFileSync(join(localDir, 'a.md'), 'local content')
    writeFileSync(join(remoteDir, 'b.md'), 'remote content')

    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pushed).toBe(0)
    expect(result.pulled).toBe(0)
    expect(result.conflicts).toBe(0)
    expect(existsSync(snapshotPath)).toBe(true)
  })

  it('second sync pushes locally added file', async () => {
    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    writeFileSync(join(localDir, 'new.md'), '# New')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pushed).toBe(1)
    const remoteContent = readFileSync(join(remoteDir, 'new.md'), 'utf-8')
    expect(remoteContent).toBe('# New')
  })

  it('second sync pulls remotely added file', async () => {
    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    writeFileSync(join(remoteDir, 'remote-new.md'), '# Remote')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.pulled).toBe(1)
    const localContent = readFileSync(join(localDir, 'remote-new.md'), 'utf-8')
    expect(localContent).toBe('# Remote')
  })

  it('creates conflict file when both sides changed', async () => {
    writeFileSync(join(localDir, 'shared.md'), 'original')
    writeFileSync(join(remoteDir, 'shared.md'), 'original')

    const local = new LocalVaultClient(localDir)
    const remote = new LocalVaultClient(remoteDir)
    await executeSync(local, remote, snapshotPath)

    writeFileSync(join(localDir, 'shared.md'), 'local edit')
    writeFileSync(join(remoteDir, 'shared.md'), 'remote edit')
    const result = await executeSync(local, remote, snapshotPath)

    expect(result.conflicts).toBe(1)
    expect(result.conflictFiles).toEqual(['shared.md'])
    expect(readFileSync(join(localDir, 'shared.md'), 'utf-8')).toBe('local edit')
    expect(readFileSync(join(localDir, 'shared.conflict.md'), 'utf-8')).toBe('remote edit')
    expect(readFileSync(join(remoteDir, 'shared.md'), 'utf-8')).toBe('local edit')
  })
})
