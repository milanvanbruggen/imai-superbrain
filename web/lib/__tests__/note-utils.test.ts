import { describe, it, expect } from 'vitest'
import { getStemFromPath } from '../note-utils'

describe('getStemFromPath', () => {
  it('extracts filename without extension', () => {
    expect(getStemFromPath('people/Alice Johnson.md')).toBe('Alice Johnson')
  })

  it('works with root-level file', () => {
    expect(getStemFromPath('Welcome.md')).toBe('Welcome')
  })

  it('strips brackets to prevent wikilink injection', () => {
    expect(getStemFromPath('notes/evil]]name.md')).toBe('evil name')
  })

  it('returns path as fallback when no extension', () => {
    expect(getStemFromPath('no-extension')).toBe('no-extension')
  })

  it('handles deeply nested path', () => {
    expect(getStemFromPath('a/b/c/deep-note.md')).toBe('deep-note')
  })
})
