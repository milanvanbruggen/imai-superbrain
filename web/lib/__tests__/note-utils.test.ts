import { describe, it, expect } from 'vitest'
import { getStemFromPath, validateVaultPath } from '../note-utils'

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

describe('validateVaultPath', () => {
  it('accepts valid relative paths', () => {
    expect(() => validateVaultPath('people/Alice.md')).not.toThrow()
    expect(() => validateVaultPath('Welcome.md')).not.toThrow()
    expect(() => validateVaultPath('a/b/c/deep.md')).not.toThrow()
  })

  it('throws on absolute path', () => {
    expect(() => validateVaultPath('/etc/passwd')).toThrow('absolute path')
  })

  it('throws on .. traversal', () => {
    expect(() => validateVaultPath('notes/../../../etc/passwd')).toThrow('traversal')
  })

  it('throws on . segment', () => {
    expect(() => validateVaultPath('./notes/foo.md')).toThrow('traversal')
  })

  it('throws on empty string', () => {
    expect(() => validateVaultPath('')).toThrow('empty')
  })
})
