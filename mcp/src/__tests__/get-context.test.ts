import { describe, it, expect } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createGetContextTool } from '../tools/get-context.js'

function makeVault(notes: { path: string; title: string; content: string; wikilinks?: string[] }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    path: n.path,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    title: n.title,
    type: 'note',
    tags: ['test'],
    content: n.content,
    wikilinks: n.wikilinks ?? [],
  }))
  vault.getAllNotes = () => parsed
  return vault
}

describe('get_context', () => {
  const notes = [
    {
      path: 'projects/superbrain.md',
      title: 'Superbrain',
      content: 'A knowledge graph that runs locally. It reads the Obsidian vault and exposes it via MCP.',
      wikilinks: ['Alice Johnson', 'Obsidian'],
    },
    {
      path: 'people/milan.md',
      title: 'Alice Johnson',
      content: 'AI Catalyst helping teams adopt AI through practical tools.',
      wikilinks: ['Superbrain'],
    },
  ]

  it('returns matching notes with excerpts', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].path).toBe('projects/superbrain.md')
    expect(result.results[0].excerpt).toContain('knowledge graph')
    expect(result.results[0].links).toEqual(['Alice Johnson', 'Obsidian'])
  })

  it('is case-insensitive', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'KNOWLEDGE GRAPH' })
    expect(result.results).toHaveLength(1)
  })

  it('returns excerpt from content start when match is title-only', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'Alice Johnson' })
    expect(result.results).toHaveLength(1)
    expect(result.results[0].excerpt).toContain('AI Catalyst')
  })

  it('truncates title-only excerpt at 200 chars with trailing ...', async () => {
    const longContent = 'word '.repeat(100) // 500 chars
    const tool = createGetContextTool(makeVault([
      { path: 'notes/long-title.md', title: 'Unique Title Match', content: longContent },
    ]))
    const result = await tool.execute({ query: 'Unique Title Match' })
    expect(result.results[0].excerpt.length).toBeLessThanOrEqual(203) // 200 + '...'
    expect(result.results[0].excerpt.endsWith('...')).toBe(true)
  })

  it('returns empty excerpt when content is empty', async () => {
    const tool = createGetContextTool(makeVault([
      { path: 'notes/empty.md', title: 'Empty Note', content: '' },
    ]))
    const result = await tool.execute({ query: 'Empty Note' })
    expect(result.results[0].excerpt).toBe('')
  })

  it('respects limit parameter', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'a', limit: 1 })
    expect(result.results).toHaveLength(1)
  })

  it('clamps limit to 10', async () => {
    const manyNotes = Array.from({ length: 15 }, (_, i) => ({
      path: `notes/note-${i}.md`,
      title: `Note ${i}`,
      content: `Content about topic ${i}`,
    }))
    const tool = createGetContextTool(makeVault(manyNotes))
    const result = await tool.execute({ query: 'topic', limit: 50 })
    expect(result.results.length).toBeLessThanOrEqual(10)
  })

  it('adds ... prefix/suffix only when excerpt is cut', async () => {
    const longContent = 'x'.repeat(150) + ' knowledge graph ' + 'y'.repeat(150)
    const tool = createGetContextTool(makeVault([
      { path: 'notes/long.md', title: 'Long', content: longContent },
    ]))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results[0].excerpt.startsWith('...')).toBe(true)
    expect(result.results[0].excerpt.endsWith('...')).toBe(true)
  })

  it('no ... prefix when match is near content start', async () => {
    const tool = createGetContextTool(makeVault(notes))
    const result = await tool.execute({ query: 'knowledge graph' })
    expect(result.results[0].excerpt.startsWith('...')).toBe(false)
  })
})
