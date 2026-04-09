import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import { migrateNote } from '@/app/api/vault/migrate/route'

describe('migrateNote', () => {
  it('returns unchanged when no managed block', () => {
    const raw = '---\ntitle: Test\n---\n\nBody text.'
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(false)
    expect(updated).toBe(raw)
  })

  it('moves managed block stems into relations frontmatter', () => {
    const raw = `---
title: Test
---

Body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(true)
    expect(updated).not.toContain('superbrain:related')
    const { data } = matter(updated)
    expect(data.relations).toHaveLength(2)
    expect(data.relations.map((r: any) => r.target)).toContain('[[NoteA]]')
    expect(data.relations.map((r: any) => r.target)).toContain('[[NoteB]]')
    expect(data.relations[0].type).toBeUndefined()
  })

  it('does not duplicate stems already in relations', () => {
    const raw = `---
title: Test
relations:
  - target: '[[NoteA]]'
    type: works_with
---

Body.
<!-- superbrain:related -->
[[NoteA]] [[NoteB]]
<!-- /superbrain:related -->`
    const { updated } = migrateNote(raw)
    const { data } = matter(updated)
    expect(data.relations).toHaveLength(2)
    const targets = data.relations.map((r: any) => r.target)
    expect(targets.filter((t: string) => t === '[[NoteA]]')).toHaveLength(1)
    expect(targets).toContain('[[NoteB]]')
  })

  it('preserves body text above the block', () => {
    const raw = `---
title: Test
---

First paragraph.
<!-- superbrain:related -->
[[NoteA]]
<!-- /superbrain:related -->`
    const { updated } = migrateNote(raw)
    expect(updated).toContain('First paragraph.')
    expect(updated).not.toContain('superbrain:related')
  })

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Test\r\n---\r\n\r\nBody.\r\n<!-- superbrain:related -->\r\n[[NoteA]]\r\n<!-- /superbrain:related -->'
    const { updated, changed } = migrateNote(raw)
    expect(changed).toBe(true)
    expect(updated).not.toContain('superbrain:related')
  })
})
