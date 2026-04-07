import { describe, it, expect } from 'vitest'
import { replaceEmailContext } from '@/app/api/gmail/append/route'

describe('replaceEmailContext', () => {
  it('appends section when none exists', () => {
    const content = '---\ntitle: Test\n---\n\nBody.'
    const result = replaceEmailContext(content, 'New summary.')
    expect(result).toContain('\n\n## Email context\n\nNew summary.\n')
    expect(result).toContain('Body.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('replaces existing section', () => {
    const content = '---\ntitle: Test\n---\n\nBody.\n\n## Email context\n\nOld summary.'
    const result = replaceEmailContext(content, 'New summary.')
    expect(result).toContain('New summary.')
    expect(result).not.toContain('Old summary.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('collapses multiple stacked sections into one', () => {
    const content = 'Intro\n\n## Email context\n\nFirst.\n\n## Email context\n\nSecond.'
    const result = replaceEmailContext(content, 'Merged.')
    expect(result).toContain('Merged.')
    expect(result).not.toContain('First.')
    expect(result).not.toContain('Second.')
    expect(result.match(/## Email context/g)?.length).toBe(1)
  })

  it('trims the summary before writing', () => {
    const content = 'Body.\n\n## Email context\n\nOld.'
    const result = replaceEmailContext(content, '  Padded summary.  ')
    expect(result.endsWith('Padded summary.\n')).toBe(true)
  })
})
