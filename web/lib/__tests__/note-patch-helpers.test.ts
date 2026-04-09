import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
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
  it('adds typed relation to frontmatter', () => {
    const raw = '---\ntitle: Test\ntype: person\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', 'works_with')
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBe('[[Superbrain]]')
    expect(data.relations[0].type).toBe('works_with')
    expect(result).not.toContain('superbrain:related')
    expect(result).toContain('Body.')
  })

  it('adds untyped link to frontmatter without type field', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyAddRelation(raw, 'Superbrain', null)
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBe('[[Superbrain]]')
    expect(data.relations[0].type).toBeUndefined()
    expect(result).not.toContain('superbrain:related')
  })

  it('does not duplicate if target already in relations', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyAddRelation(raw, 'Superbrain', 'part_of')
    const { data } = matter(result)
    expect(data.relations).toHaveLength(1)
  })

  it('appends second distinct relation to existing non-empty relations array', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[NoteA]]'\n    type: works_with\n---\n\nBody."
    const result = applyAddRelation(raw, 'NoteB', 'part_of')
    const { data } = matter(result)
    expect(data.relations).toHaveLength(2)
    expect(data.relations[1].target).toBe('[[NoteB]]')
    expect(data.relations[1].type).toBe('part_of')
  })

  it('does not duplicate when called twice for same target', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const afterFirst = applyAddRelation(raw, 'Superbrain', null)
    const afterSecond = applyAddRelation(afterFirst, 'Superbrain', null)
    const { data } = matter(afterSecond)
    expect(data.relations).toHaveLength(1)
  })
})

describe('applyRemoveRelation', () => {
  it('removes typed relation from frontmatter', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[Superbrain]]'\n    type: works_with\n---\n\nBody."
    const result = applyRemoveRelation(raw, 'Superbrain')
    const { data } = matter(result)
    expect(data.relations).toBeUndefined()
    expect(result).toContain('Body.')
    expect(result).not.toContain('Superbrain')
  })

  it('removes untyped relation from frontmatter', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: '[[NoteA]]'\n---\n\nBody."
    const result = applyRemoveRelation(raw, 'NoteA')
    const { data } = matter(result)
    expect(data.relations).toBeUndefined()
    expect(result).not.toContain('NoteA')
    expect(result).toContain('Body.')
  })

  it('is a no-op when target not in relations', () => {
    const raw = '---\ntitle: Test\n---\n\nBody.'
    const result = applyRemoveRelation(raw, 'Missing')
    expect(result).toContain('Body.')
    expect(result).not.toContain('Missing')
  })

  it('does not throw when relations array contains a non-string target', () => {
    const raw = "---\ntitle: Test\nrelations:\n  - target: null\n    type: works_with\n  - target: '[[NoteA]]'\n    type: references\n---\n\nBody."
    expect(() => applyRemoveRelation(raw, 'NoteA')).not.toThrow()
    const { data } = matter(applyRemoveRelation(raw, 'NoteA'))
    expect(data.relations).toHaveLength(1)
    expect(data.relations[0].target).toBeNull()
  })
})
