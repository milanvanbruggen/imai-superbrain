import { describe, it, expect } from 'vitest'
import { rankPaletteItem as rank } from '../palette-rank'

const item = (title: string, ...rest: string[]) => [`people/${title}.md`, [title, ...rest]] as const

describe('rankPaletteItem', () => {
  it('puts an exact title first, then shorter titles that start with the search', () => {
    const [v4, k4] = item('Persoon 4', 'person')
    const [v49, k49] = item('Persoon 49', 'person')
    const [vX, kX] = item('Een Persoon 4 notitie', 'note')
    expect(rank(v4, 'persoon 4', [...k4])).toBe(1)
    expect(rank(v49, 'persoon 4', [...k49])).toBeLessThan(1)
    expect(rank(v49, 'persoon 4', [...k49])).toBeGreaterThan(rank(vX, 'persoon 4', [...kX]))
  })

  it('finds a note by its tags or type when the title does not match', () => {
    const [v, k] = item('Ledenavond', 'meeting', 'ddz')
    expect(rank(v, 'ddz meeting', [...k])).toBeGreaterThan(0)
    expect(rank(v, 'propositio', [...k])).toBe(0)
  })
})
