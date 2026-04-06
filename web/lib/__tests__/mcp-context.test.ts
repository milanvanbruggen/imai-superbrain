// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/vault-client', () => ({
  getVaultClient: vi.fn(),
}))
vi.mock('@/lib/vault-parser', () => ({
  buildGraph: () => ({ nodes: [], edges: [], notesByStem: {} }),
}))

// Reset module cache after every test so vi.doMock overrides in getContextText tests
// don't leak into subsequent imports.
afterEach(() => {
  vi.resetModules()
})

describe('searchNoteMap', () => {
  it('returns notes matching query in title', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map([
      ['a/note.md', { path: 'a/note.md', title: 'My Project Notes', type: 'note', tags: [], content: 'some content' }],
      ['b/other.md', { path: 'b/other.md', title: 'Something Else', type: 'note', tags: [], content: 'unrelated' }],
    ])
    const results = searchNoteMap(noteMap, 'project')
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe('a/note.md')
  })

  it('returns notes matching query in content', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map([
      ['a/note.md', { path: 'a/note.md', title: 'General', type: 'note', tags: [], content: 'details about TypeScript' }],
    ])
    const results = searchNoteMap(noteMap, 'typescript')
    expect(results).toHaveLength(1)
  })

  it('returns at most 10 results', async () => {
    const { searchNoteMap } = await import('@/app/api/mcp/route')
    const noteMap = new Map(
      Array.from({ length: 15 }, (_, i) => [
        `note-${i}.md`,
        { path: `note-${i}.md`, title: `Match ${i}`, type: 'note', tags: [], content: 'matching content' },
      ])
    )
    const results = searchNoteMap(noteMap, 'match')
    expect(results).toHaveLength(10)
  })
})

describe('getContextText', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns placeholder when vault client throws', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => { throw new Error('not configured') },
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText()
    expect(result).toBe('(No personal context configured. Create Claude/profile.md in your vault to get started.)')
  })

  it('returns structured sections for existing and missing files', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => ({
        readFile: async (path: string) => {
          if (path === 'Claude/profile.md') return { content: 'I am Milan', sha: null }
          throw new Error('not found')
        },
        getMarkdownTree: async () => [],
      }),
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText()
    expect(result).toContain('## Profile\nI am Milan')
    expect(result).toContain('## Active Projects\n(not set up yet)')  // intentional user input → not set up yet
    expect(result).toContain('## Memory: User\n(empty)')              // auto-generated memory file → empty
  })

  it('appends related notes section when topic is given', async () => {
    vi.doMock('@/lib/vault-client', () => ({
      getVaultClient: () => ({
        readFile: async () => ({ content: '', sha: null }),
        getMarkdownTree: async () => [{ path: 'projects/foo.md' }],
      }),
    }))
    vi.doMock('@/lib/vault-parser', () => ({
      buildGraph: () => ({
        nodes: [{ path: 'projects/foo.md', title: 'Foo Project', type: 'note', tags: [] }],
        edges: [],
        notesByStem: {},
      }),
    }))
    const { getContextText } = await import('@/app/api/mcp/route')
    const result = await getContextText('foo')
    expect(result).toContain('## Related Notes (topic: "foo")')
    expect(result).toContain('projects/foo.md — Foo Project')
  })
})
