import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { LocalVaultClient } from '../local'

let vaultDir: string
let client: LocalVaultClient

describe('LocalVaultClient', () => {
  beforeEach(() => {
    vaultDir = join(tmpdir(), `vault-test-${Date.now()}`)
    mkdirSync(vaultDir, { recursive: true })
    client = new LocalVaultClient(vaultDir)
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  it('getMarkdownTree returns all .md files recursively', async () => {
    mkdirSync(join(vaultDir, 'people'))
    writeFileSync(join(vaultDir, 'README.md'), '# Hello')
    writeFileSync(join(vaultDir, 'people', 'Milan.md'), '# Milan')
    writeFileSync(join(vaultDir, 'people', 'photo.jpg'), 'binary')

    const tree = await client.getMarkdownTree()
    const paths = tree.map(f => f.path).sort()

    expect(paths).toEqual(['README.md', 'people/Milan.md'])
  })

  it('getMarkdownTree returns stable SHA for unchanged files', async () => {
    writeFileSync(join(vaultDir, 'note.md'), '# Note')

    const tree1 = await client.getMarkdownTree()
    const tree2 = await client.getMarkdownTree()

    expect(tree1[0].sha).toBe(tree2[0].sha)
  })

  it('readFile returns content and SHA', async () => {
    writeFileSync(join(vaultDir, 'hello.md'), '# Hello World')

    const result = await client.readFile('hello.md')

    expect(result.content).toBe('# Hello World')
    expect(result.sha).toMatch(/^[a-f0-9]{40}$/) // SHA-1 hex
  })

  it('readFile SHA changes when content changes', async () => {
    writeFileSync(join(vaultDir, 'note.md'), 'version 1')
    const { sha: sha1 } = await client.readFile('note.md')

    writeFileSync(join(vaultDir, 'note.md'), 'version 2')
    const { sha: sha2 } = await client.readFile('note.md')

    expect(sha1).not.toBe(sha2)
  })

  it('readFile throws for missing file', async () => {
    await expect(client.readFile('nonexistent.md')).rejects.toThrow(/ENOENT/)
  })

  it('writeFile creates a new file', async () => {
    await client.writeFile('new-note.md', '# New', null, 'ignored message')

    const result = await client.readFile('new-note.md')
    expect(result.content).toBe('# New')
  })

  it('writeFile creates parent directories', async () => {
    await client.writeFile('people/Milan.md', '# Milan', null, 'ignored')

    const result = await client.readFile('people/Milan.md')
    expect(result.content).toBe('# Milan')
  })

  it('writeFile overwrites existing file (ignores SHA)', async () => {
    writeFileSync(join(vaultDir, 'note.md'), 'original')

    await client.writeFile('note.md', 'updated', 'any-sha', 'ignored')

    const result = await client.readFile('note.md')
    expect(result.content).toBe('updated')
  })

  it('writeFile throws on path traversal attempt', async () => {
    await expect(
      client.writeFile('../escape.md', 'evil', null, 'hack')
    ).rejects.toThrow(/traversal/i)
  })

  it('readFile throws on path traversal attempt', async () => {
    await expect(
      client.readFile('../escape.md')
    ).rejects.toThrow(/traversal/i)
  })
})
