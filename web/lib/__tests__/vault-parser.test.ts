import { describe, it, expect } from 'vitest'
import { parseNote, buildGraph, resolveWikilink } from '../vault-parser'

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
