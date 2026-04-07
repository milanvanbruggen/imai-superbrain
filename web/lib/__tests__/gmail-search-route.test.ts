import { describe, it, expect } from 'vitest'
import { buildSearchPayload } from '@/app/api/gmail/search/route'

describe('buildSearchPayload', () => {
  it('uses title and email when both present', () => {
    const query = buildSearchPayload({ title: 'Jan Jansen', email: 'jan@test.com' })
    expect(query).toBe('"Jan Jansen" OR "jan@test.com"')
  })

  it('uses only title when email is missing', () => {
    const query = buildSearchPayload({ title: 'Jan Jansen', email: undefined })
    expect(query).toBe('"Jan Jansen"')
  })
})
