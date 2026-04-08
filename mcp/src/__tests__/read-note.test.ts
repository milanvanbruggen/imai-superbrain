import { describe, it, expect, beforeEach } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createReadTool } from '../tools/read-note.js'

function makeVault(notes: { path: string; content: string }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    path: n.path,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    title: n.path.split('/').pop()!.replace(/\.md$/, ''),
    type: 'note',
    tags: [],
    content: n.content,
    wikilinks: [],
  }))
  vault.getNoteByPath = (p: string) => parsed.find(n => n.path === p)
  vault.getNoteByTitle = (t: string) => parsed.find(n => n.title.toLowerCase() === t.toLowerCase())
  return vault
}

describe('read_note truncation', () => {
  const longContent = 'Line one\n'.repeat(300)
  const shortContent = 'Short note content.'
  let tool: ReturnType<typeof createReadTool>

  beforeEach(() => {
    tool = createReadTool(makeVault([
      { path: 'notes/long.md', content: longContent },
      { path: 'notes/short.md', content: shortContent },
    ]))
  })

  it('truncates content at nearest newline before 2000 chars by default', async () => {
    const result = await tool.execute({ path: 'notes/long.md' })
    expect(result.content.length).toBeLessThanOrEqual(2000)
    expect(result.content.endsWith('\n')).toBe(true)
    expect(result.truncated).toBe(true)
  })

  it('returns full content when full=true', async () => {
    const result = await tool.execute({ path: 'notes/long.md', full: true })
    expect(result.content).toBe(longContent)
    expect(result.truncated).toBeUndefined()
  })

  it('does not truncate short content', async () => {
    const result = await tool.execute({ path: 'notes/short.md' })
    expect(result.content).toBe(shortContent)
    expect(result.truncated).toBeUndefined()
  })

  it('hard-cuts at 2000 when no newline exists before limit', async () => {
    const noNewlines = 'a'.repeat(3000)
    const vault = makeVault([{ path: 'notes/no-nl.md', content: noNewlines }])
    const t = createReadTool(vault)
    const result = await t.execute({ path: 'notes/no-nl.md' })
    expect(result.content.length).toBe(2000)
    expect(result.truncated).toBe(true)
  })
})
