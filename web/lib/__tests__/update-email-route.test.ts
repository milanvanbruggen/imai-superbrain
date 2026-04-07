import { describe, it, expect } from 'vitest'
import { spliceEmailIntoFrontmatter } from '@/app/api/vault/update-email/route'

describe('spliceEmailIntoFrontmatter', () => {
  it('adds email field to existing frontmatter', () => {
    const raw = '---\ntitle: Milan\ntype: person\n---\n\nBody text.'
    const result = spliceEmailIntoFrontmatter(raw, 'milan@example.com')
    expect(result).toContain('email: milan@example.com')
    expect(result).toContain('title: Milan')
    expect(result).toContain('Body text.')
  })

  it('preserves body byte-for-byte', () => {
    const body = '\n\nSome **markdown** body.\n\n[[Wikilink]]  '
    const raw = `---\ntitle: Test\n---${body}`
    const result = spliceEmailIntoFrontmatter(raw, 'test@example.com')
    // Body after closing --- must be identical
    const bodyStart = result.indexOf('---', 4) + 3
    expect(result.slice(bodyStart)).toBe(body)
  })

  it('updates existing email in frontmatter without duplicating', () => {
    const raw = '---\ntitle: Milan\nemail: old@example.com\ntype: person\n---\n\nBody.'
    const result = spliceEmailIntoFrontmatter(raw, 'new@example.com')
    expect(result).toContain('email: new@example.com')
    expect(result).not.toContain('old@example.com')
    expect(result.match(/email:/g)?.length).toBe(1)
  })

  it('handles note with no frontmatter by prepending one', () => {
    const raw = 'Just a body with no frontmatter.'
    const result = spliceEmailIntoFrontmatter(raw, 'test@example.com')
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('email: test@example.com')
    expect(result).toContain(raw)
  })
})
