import { describe, it, expect } from 'vitest'
import { buildGmailQuery, sanitizeQueryTerm } from '../gmail-client'

describe('sanitizeQueryTerm', () => {
  it('strips Gmail search operators from input', () => {
    expect(sanitizeQueryTerm('foo(bar):baz"qux')).toBe('foobarbazqux')
  })

  it('preserves normal alphanumeric and spaces', () => {
    expect(sanitizeQueryTerm('Milan van Bruggen')).toBe('Milan van Bruggen')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeQueryTerm('')).toBe('')
  })
})

describe('buildGmailQuery', () => {
  it('builds query with name only', () => {
    expect(buildGmailQuery('Milan van Bruggen', undefined)).toBe('"Milan van Bruggen"')
  })

  it('builds query with name and email', () => {
    expect(buildGmailQuery('Milan van Bruggen', 'milan@example.com')).toBe('"Milan van Bruggen" OR "milan@example.com"')
  })

  it('sanitizes inputs before building', () => {
    expect(buildGmailQuery('Foo:Bar', 'a"b@x.com')).toBe('"FooBar" OR "ab@x.com"')
  })
})
