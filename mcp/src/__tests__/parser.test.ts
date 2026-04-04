import { describe, it, expect } from 'vitest'
import { parseMarkdown, extractWikilinks, resolveWikilink } from '../parser.js'

describe('parseMarkdown', () => {
  it('extracts title from frontmatter', () => {
    const result = parseMarkdown('notes/test.md', '---\ntitle: Test\n---\nHello')
    expect(result.title).toBe('Test')
  })

  it('falls back to stem for title', () => {
    const result = parseMarkdown('notes/my-note.md', 'Hello world')
    expect(result.title).toBe('my-note')
  })

  it('extracts tags as array', () => {
    const result = parseMarkdown('notes/test.md', '---\ntags: [foo, bar]\n---\n')
    expect(result.tags).toEqual(['foo', 'bar'])
  })
})

describe('extractWikilinks', () => {
  it('extracts unique wikilinks', () => {
    const links = extractWikilinks('See [[Foo]] and [[Bar]] and [[Foo]] again')
    expect(links).toEqual(['Foo', 'Bar'])
  })

  it('returns empty array for no links', () => {
    expect(extractWikilinks('No links here')).toEqual([])
  })
})

describe('resolveWikilink', () => {
  const notes = [
    { stem: 'Milan van Bruggen', path: 'people/Milan van Bruggen.md' },
    { stem: 'Superbrain', path: 'projects/Superbrain.md' },
  ]

  it('resolves case-insensitively', () => {
    expect(resolveWikilink('milan van bruggen', notes)?.stem).toBe('Milan van Bruggen')
    expect(resolveWikilink('SUPERBRAIN', notes)?.stem).toBe('Superbrain')
  })

  it('returns null for unknown links', () => {
    expect(resolveWikilink('Unknown', notes)).toBeNull()
  })
})
