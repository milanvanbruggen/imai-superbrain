import { describe, it, expect } from 'vitest'
import { applySetType, applyAddRelation, applyRemoveRelation } from '@/app/api/vault/note/[...path]/route'

describe('applySetType', () => {
  it('updates type in existing frontmatter', () => {
    const raw = '---\ntitle: Test\ntype: note\n---\n\nBody.'
    const result = applySetType(raw, 'project')
    expect(result).toContain('type: project')
    expect(result).not.toContain('type: note')
    expect(result).toContain('Body.')
  })

  it('adds type when missing from frontmatter', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applySetType(raw, 'idea')
    expect(result).toContain('type: idea')
    expect(result).toContain('Body.')
  })
})

describe('applyAddRelation', () => {
  it('adds typed relation to frontmatter and managed block', () => {
    const raw = '---\ntitle: Test\ntype: person\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', 'works_with')
    expect(result).toContain('Superbrain')
    expect(result).toContain('works_with')
    expect(result).toContain('<!-- superbrain:related -->')
    expect(result).toContain('[[Superbrain]]')
    expect(result).toContain('Body.')
  })

  it('adds untyped link only to managed block, not frontmatter relations', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', null)
    expect(result).not.toContain('relations:')
    expect(result).toContain('[[Superbrain]]')
    expect(result).toContain('<!-- superbrain:related -->')
  })

  it('does not duplicate typed relation if target already in relations', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyAddRelation(raw, 'Superbrain', 'part_of')
    expect(result.match(/target:/g)?.length).toBe(1)
  })

  it('does not add duplicate wikilink to managed block when called twice for same target', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const afterFirst = applyAddRelation(raw, 'Superbrain', null)
    const afterSecond = applyAddRelation(afterFirst, 'Superbrain', null)
    expect(afterSecond.match(/\[\[Superbrain\]\]/g)?.length).toBe(1)
  })
})

describe('applyRemoveRelation', () => {
  it('removes typed relation from frontmatter and body block', () => {
    const raw = `---
title: Test
relations:
  - target: '[[Superbrain]]'
    type: works_with
---

Body.
<!-- superbrain:related -->
[[Superbrain]]
<!-- /superbrain:related -->`
    const result = applyRemoveRelation(raw, 'Superbrain')
    expect(result).not.toContain('Superbrain')
    expect(result).not.toContain('relations:')
    expect(result).not.toContain('superbrain:related')
  })

  it('removes untyped managed link from body block only', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.\n<!-- superbrain:related -->\n[[NoteA]]\n<!-- /superbrain:related -->'
    const result = applyRemoveRelation(raw, 'NoteA')
    expect(result).not.toContain('NoteA')
    expect(result).not.toContain('superbrain:related')
    expect(result).toContain('Body.')
  })

  it('is a no-op when target not found anywhere', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyRemoveRelation(raw, 'Missing')
    expect(result).toContain('Body.')
    expect(result).not.toContain('Missing')
  })

  it('does not throw when relations array contains an entry with a non-string target', () => {
    const raw = '---\ntitle: Test\nrelations:\n  - target: null\n    type: works_with\n  - target: \'[[NoteA]]\'\n    type: references\n---\n\nBody.'
    expect(() => applyRemoveRelation(raw, 'NoteA')).not.toThrow()
    const result = applyRemoveRelation(raw, 'NoteA')
    expect(result).not.toContain('NoteA')
  })
})
