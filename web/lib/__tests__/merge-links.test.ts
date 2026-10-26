import { describe, it, expect } from 'vitest'
import { linksTo, retargetLinks } from '../merge-links'
import { parseNote } from '../vault-parser'

const FROM = 'areas/DDZ.md'
const TO = 'Digital District Zwolle'

describe('retargetLinks', () => {
  it('matches a link by stem or by path, in any case', () => {
    expect(linksTo('DDZ', FROM)).toBe(true)
    expect(linksTo('ddz', FROM)).toBe(true)
    expect(linksTo('areas/DDZ', FROM)).toBe(true)
    expect(linksTo('DDZ meetup', FROM)).toBe(false)
  })

  it('points body links at the remaining note and keeps the text they showed', () => {
    const raw = 'Bestuur van [[DDZ]], zie [[DDZ#Leden|de leden]] en [[DDZ meetup]].\n'
    expect(retargetLinks(raw, FROM, TO)).toBe(
      'Bestuur van [[Digital District Zwolle|DDZ]], zie [[Digital District Zwolle#Leden|de leden]] en [[DDZ meetup]].\n')
  })

  it('points relations at the remaining note, with or without brackets', () => {
    const raw = '---\nrelations:\n  - target: "[[DDZ]]"\n    type: part_of\n  - target: DDZ\n  - target: Other\n---\nBody\n'
    expect(retargetLinks(raw, FROM, TO)).toBe(
      '---\nrelations:\n  - target: "[[Digital District Zwolle]]"\n    type: part_of\n  - target: "[[Digital District Zwolle]]"\n  - target: Other\n---\nBody\n')
  })

  it('writes relations that still parse as relations', () => {
    const raw = '---\nrelations:\n  - target: DDZ\n    type: part_of\n---\nBody\n'
    const note = parseNote('meetings/Ledenavond.md', retargetLinks(raw, FROM, TO))
    expect(note.relations).toEqual([{ target: TO, type: 'part_of' }])
  })

  it('leaves a file without such links untouched', () => {
    const raw = '---\ntype: note\n---\nNothing about [[Propositio]].\n'
    expect(retargetLinks(raw, FROM, TO)).toBe(raw)
  })

  it('keeps the link working for the parser', () => {
    const note = parseNote('meetings/Ledenavond.md', retargetLinks('Bij [[DDZ]].', FROM, TO))
    expect(note.wikilinks).toEqual([TO])
  })
})
