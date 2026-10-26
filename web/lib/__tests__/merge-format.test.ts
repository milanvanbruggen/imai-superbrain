import { describe, it, expect } from 'vitest'
import { formatAsSection, mergedBody } from '../merge-format'

describe('mergedBody', () => {
  it('adds an inbox note as a dated update', () => {
    const body = mergedBody({ title: 'Update', content: 'Update voor [[DDZ]]:\nNieuwe voorzitter.', inbox: true, date: '2026-10-26' }, 'Vereniging.')
    expect(body).toBe('Vereniging.\n\n- **26 okt 2026** — Nieuwe voorzitter.')
  })

  it('adds a whole note as its own section, under its title', () => {
    const body = mergedBody({ title: 'DDZ', content: 'Mijn bestuursrol.\n\nAgenda en notulen.', inbox: false }, 'Netwerk van digitale bedrijven.')
    expect(body).toBe('Netwerk van digitale bedrijven.\n\n## DDZ\n\nMijn bestuursrol.\n\nAgenda en notulen.')
  })

  it('keeps the target as it is when the source has no body', () => {
    expect(mergedBody({ title: 'DDZ', content: '  \n', inbox: false }, 'Netwerk.')).toBe('Netwerk.')
  })

  it('uses only the section when the target has no body', () => {
    expect(mergedBody({ title: 'DDZ', content: 'Rol.', inbox: false }, '')).toBe('## DDZ\n\nRol.')
  })
})

describe('formatAsSection', () => {
  it('drops a first heading that repeats the title and moves the other headings under the section', () => {
    const content = '# DDZ\n\nIntro.\n\n## Taken\n\n- notulen\n\n### Details\n\nMeer.'
    expect(formatAsSection('DDZ', content)).toBe('## DDZ\n\nIntro.\n\n### Taken\n\n- notulen\n\n#### Details\n\nMeer.')
  })

  it('leaves headings in code blocks alone', () => {
    const content = 'Tekst.\n\n## Kop\n\n```md\n# not a heading\n```'
    expect(formatAsSection('X', content)).toBe('## X\n\nTekst.\n\n### Kop\n\n```md\n# not a heading\n```')
  })

  it('is empty for a note with only its title as heading', () => {
    expect(formatAsSection('DDZ', '# DDZ\n')).toBe('')
  })
})
