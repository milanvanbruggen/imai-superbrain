import { describe, it, expect } from 'vitest'
import { extractEmailContext } from '@/app/api/gmail/summarize/route'

describe('extractEmailContext', () => {
  it('returns null when section is absent', () => {
    const content = '---\ntitle: Test\n---\n\nSome body.'
    expect(extractEmailContext(content)).toBeNull()
  })

  it('extracts content from existing section', () => {
    const content = '---\ntitle: Test\n---\n\nBody.\n\n## Email context\n\nExisting summary text.'
    expect(extractEmailContext(content)).toBe('Existing summary text.')
  })

  it('stops at the next ## heading', () => {
    const content = 'Intro\n\n## Email context\n\nSummary here.\n\n## Other section\n\nOther content.'
    expect(extractEmailContext(content)).toBe('Summary here.')
  })

  it('returns null when section exists but is empty', () => {
    const content = 'Intro\n\n## Email context\n\n\n\n## Next section'
    expect(extractEmailContext(content)).toBeNull()
  })

  it('stops at a heading preceded by a single newline', () => {
    const content = 'Intro\n\n## Email context\n\nSummary.\n## Adjacent section\n\nContent.'
    expect(extractEmailContext(content)).toBe('Summary.')
  })
})
