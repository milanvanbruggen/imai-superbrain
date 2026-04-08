import { describe, it, expect } from 'vitest'
import { VaultReader } from '../vault-reader.js'
import { createGetIndexTool } from '../tools/get-index.js'

function makeVault(notes: { path: string; title: string; type: string; tags: string[]; wikilinks: string[] }[]): VaultReader {
  const vault = Object.create(VaultReader.prototype)
  const parsed = notes.map(n => ({
    ...n,
    stem: n.path.split('/').pop()!.replace(/\.md$/, ''),
    content: '',
  }))
  vault.getAllNotes = () => parsed
  return vault
}

describe('get_index', () => {
  const notes = [
    { path: 'people/milan.md', title: 'Milan', type: 'person', tags: ['founder'], wikilinks: ['Superbrain', 'Obsidian'] },
    { path: 'projects/superbrain.md', title: 'Superbrain', type: 'project', tags: ['ai'], wikilinks: ['Milan'] },
    { path: 'notes/empty.md', title: 'Empty', type: 'note', tags: [], wikilinks: [] },
  ]

  it('returns all notes with structural metadata', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    expect(result.notes).toHaveLength(3)
  })

  it('includes link_count matching links array length', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    const milan = result.notes.find((n: any) => n.path === 'people/milan.md')
    expect(milan!.link_count).toBe(2)
    expect(milan!.links).toEqual(['Superbrain', 'Obsidian'])
  })

  it('does not include content field', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    result.notes.forEach((n: any) => {
      expect(n).not.toHaveProperty('content')
    })
  })

  it('handles notes with zero links', async () => {
    const tool = createGetIndexTool(makeVault(notes))
    const result = await tool.execute()
    const empty = result.notes.find((n: any) => n.path === 'notes/empty.md')
    expect(empty!.link_count).toBe(0)
    expect(empty!.links).toEqual([])
  })
})
