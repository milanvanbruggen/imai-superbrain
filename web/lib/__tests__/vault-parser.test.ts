import { describe, it, expect } from 'vitest'
import { parseNote, buildGraph, resolveWikilink, extractManagedBlock, addToManagedBlock, removeFromManagedBlock } from '../vault-parser'

const SAMPLE_NOTE = `---
title: Alice Johnson
type: person
tags: [founder, indie]
date: 2026-01-01
relations:
  - target: "[[Superbrain]]"
    type: works_with
---

Building [[Superbrain]] and thinking about [[ambient computing]].
Also related to [[Superbrain]] again.
`

describe('parseNote', () => {
  it('extracts frontmatter fields', () => {
    const note = parseNote('people/Alice Johnson.md', SAMPLE_NOTE)
    expect(note.title).toBe('Alice Johnson')
    expect(note.type).toBe('person')
    expect(note.tags).toEqual(['founder', 'indie'])
    expect(note.date).toBe('2026-01-01')
  })

  it('extracts typed relations from frontmatter', () => {
    const note = parseNote('people/Alice Johnson.md', SAMPLE_NOTE)
    expect(note.relations).toEqual([{ target: 'Superbrain', type: 'works_with' }])
  })

  it('extracts unique wikilinks from body', () => {
    const note = parseNote('people/Alice Johnson.md', SAMPLE_NOTE)
    expect(note.wikilinks).toEqual(['Superbrain', 'ambient computing'])
  })

  it('uses prettified stem as title when frontmatter title is missing', () => {
    const note = parseNote('notes/quick-idea.md', '# Quick idea\n\nsome text')
    expect(note.title).toBe('Quick Idea')
    expect(note.stem).toBe('quick-idea')
  })

  it('defaults type to note when missing', () => {
    const note = parseNote('notes/quick-idea.md', 'just some text')
    expect(note.type).toBe('note')
  })

  it('formats YAML date as YYYY-MM-DD string', () => {
    const note = parseNote('notes/dated.md', '---\ntitle: Dated\ndate: 2026-01-15\n---\nHello')
    expect(note.date).toBe('2026-01-15')
    expect(typeof note.date).toBe('string')
  })

  it('parses type: meeting', () => {
    const note = parseNote('meetings/standup.md', '---\ntype: meeting\n---\n')
    expect(note.type).toBe('meeting')
  })

  it('parses type: daily', () => {
    const note = parseNote('daily/2026-04-05.md', '---\ntype: daily\n---\n')
    expect(note.type).toBe('daily')
  })

  it('parses type: area', () => {
    const note = parseNote('areas/health.md', '---\ntype: area\n---\n')
    expect(note.type).toBe('area')
  })

  it('accepts a custom type not in the default list', () => {
    const note = parseNote('notes/foo.md', '---\ntype: klant\n---\n')
    expect(note.type).toBe('klant')
  })

  it('falls back to note when type is empty string', () => {
    const note = parseNote('notes/foo.md', '---\ntype: ""\n---\n')
    expect(note.type).toBe('note')
  })

  it('falls back to note when type is whitespace only', () => {
    const note = parseNote('notes/foo.md', '---\ntype: "   "\n---\n')
    expect(note.type).toBe('note')
  })

  it('falls back to note when type is a non-string YAML value', () => {
    const note = parseNote('notes/foo.md', '---\ntype: 42\n---\n')
    expect(note.type).toBe('note')
  })
})

describe('resolveWikilink', () => {
  const notes = [
    { stem: 'alice johnson', path: 'people/Alice Johnson.md' },
    { stem: 'superbrain', path: 'projects/Superbrain.md' },
    { stem: 'ambient computing', path: 'ideas/Ambient Computing.md' },
  ]

  it('resolves case-insensitively', () => {
    expect(resolveWikilink('Alice Johnson', notes)).toBe('alice johnson')
    expect(resolveWikilink('ALICE JOHNSON', notes)).toBe('alice johnson')
  })

  it('returns null for unresolved links', () => {
    expect(resolveWikilink('Unknown Note', notes)).toBeNull()
  })
})

describe('buildGraph', () => {
  const notes: [string, string][] = [
    ['people/Milan.md', '---\ntitle: Milan\ntype: person\n---\n\nSee [[Superbrain]].'],
    ['projects/Superbrain.md', '---\ntitle: Superbrain\ntype: project\nrelations:\n  - target: "[[Milan]]"\n    type: works_with\n---\n\nBuilt by [[Milan]].'],
  ]

  it('creates nodes for each note', () => {
    const graph = buildGraph(notes)
    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map(n => n.id)).toContain('milan')
    expect(graph.nodes.map(n => n.id)).toContain('superbrain')
  })

  it('creates edges for wikilinks', () => {
    const graph = buildGraph(notes)
    const untyped = graph.edges.filter(e => !e.typed)
    expect(untyped.length).toBeGreaterThan(0)
  })

  it('suppresses untyped edge when typed relation covers same pair', () => {
    const graph = buildGraph(notes)
    // Superbrain has typed relation to Milan AND body wikilink to Milan
    // Only the typed edge should remain
    const superbrain_to_milan = graph.edges.filter(
      e => e.source === 'superbrain' && e.target === 'milan'
    )
    expect(superbrain_to_milan).toHaveLength(1)
    expect(superbrain_to_milan[0].typed).toBe(true)
  })
})

describe('extractManagedBlock', () => {
  it('returns empty array when no block present', () => {
    expect(extractManagedBlock('just some text')).toEqual([])
  })

  it('extracts stems from managed block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Note1]] [[Note2]]\n<!-- /superbrain:related -->'
    expect(extractManagedBlock(content)).toEqual(['Note1', 'Note2'])
  })

  it('returns empty array for empty block', () => {
    const content = '<!-- superbrain:related -->\n\n<!-- /superbrain:related -->'
    expect(extractManagedBlock(content)).toEqual([])
  })
})

describe('addToManagedBlock', () => {
  it('creates block when none exists', () => {
    const result = addToManagedBlock('some content', 'NewNote')
    expect(result).toContain('<!-- superbrain:related -->')
    expect(result).toContain('[[NewNote]]')
    expect(result).toContain('<!-- /superbrain:related -->')
    expect(result).toContain('some content')
  })

  it('appends to existing block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Existing]]\n<!-- /superbrain:related -->'
    const result = addToManagedBlock(content, 'NewNote')
    expect(result).toContain('[[Existing]]')
    expect(result).toContain('[[NewNote]]')
  })

  it('does not duplicate if stem already present', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Note]]\n<!-- /superbrain:related -->'
    const result = addToManagedBlock(content, 'Note')
    expect(result.match(/\[\[Note\]\]/g)?.length).toBe(1)
  })
})

describe('removeFromManagedBlock', () => {
  it('removes one stem from block with multiple', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[A]] [[B]]\n<!-- /superbrain:related -->'
    const result = removeFromManagedBlock(content, 'A')
    expect(result).not.toContain('[[A]]')
    expect(result).toContain('[[B]]')
  })

  it('removes entire block when last stem is removed', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[Only]]\n<!-- /superbrain:related -->'
    const result = removeFromManagedBlock(content, 'Only')
    expect(result).not.toContain('superbrain:related')
    expect(result.trim()).toBe('body')
  })

  it('returns content unchanged when stem not in block', () => {
    const content = 'body\n<!-- superbrain:related -->\n[[A]]\n<!-- /superbrain:related -->'
    expect(removeFromManagedBlock(content, 'Missing')).toBe(content)
  })

  it('returns content unchanged when no block exists', () => {
    expect(removeFromManagedBlock('just some text', 'Note')).toBe('just some text')
  })
})

describe('parseNote - managedLinks', () => {
  it('returns empty array when no managed block', () => {
    const note = parseNote('notes/foo.md', 'just text')
    expect(note.managedLinks).toEqual([])
  })

  it('extracts managed links from body block', () => {
    const raw = `---
title: Test
---

Some body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const note = parseNote('notes/test.md', raw)
    expect(note.managedLinks).toEqual(['NoteA', 'NoteB'])
  })

  it('managed link stems also appear in wikilinks (graph uses them for edges)', () => {
    const raw = `---
title: Test
---

Some body.
<!-- superbrain:related -->
[[NoteA]]
<!-- /superbrain:related -->`
    const note = parseNote('notes/test.md', raw)
    expect(note.managedLinks).toContain('NoteA')
    expect(note.wikilinks).toContain('NoteA')
  })
})
