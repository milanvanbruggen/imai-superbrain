import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VaultClient } from '../vault-client'

const files: Record<string, string> = {}
const client: VaultClient = {
  getMarkdownTree: async () => Object.keys(files).map(path => ({ path, sha: `sha-${path}` })),
  getSystemFiles: async () => [],
  readFile: async path => {
    if (!(path in files)) throw new Error(`404 ${path}`)
    return { content: files[path], sha: `sha-${path}` }
  },
  writeFile: async (path, content) => { files[path] = content },
  deleteFile: async path => { delete files[path] },
}

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { name: 'me' } }) }))
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }))
vi.mock('@/lib/vault-client', () => ({ getVaultClient: () => client }))

const { POST } = await import('@/app/api/vault/merge/route')
const { parseNote } = await import('../vault-parser')

function merge(sourcePath: string, targetPath: string) {
  return POST(new Request('http://x/api/vault/merge', {
    method: 'POST',
    body: JSON.stringify({ sourcePath, targetPath }),
  }) as never)
}

describe('POST /api/vault/merge', () => {
  beforeEach(() => {
    for (const k of Object.keys(files)) delete files[k]
    Object.assign(files, {
      'areas/DDZ.md': '---\ntype: area\nrelations:\n  - target: "[[Digital District Zwolle]]"\n---\nMijn bestuursrol.\n',
      'companies/Digital District Zwolle.md': '---\ntype: company\n---\nNetwerk van digitale bedrijven.\n',
      'meetings/Ledenavond.md': '---\ntype: meeting\nrelations:\n  - target: "[[DDZ]]"\n    type: part_of\n---\nLedenavond van [[DDZ]].\n',
      'notes/Other.md': '---\ntype: note\n---\nNiets.\n',
    })
  })

  it('merges, deletes the source and points links to it at the target', async () => {
    const res = await merge('areas/DDZ.md', 'companies/Digital District Zwolle.md')
    expect(await res.json()).toEqual({ ok: true, relinked: 1, relinkFailed: 0 })

    expect(files['areas/DDZ.md']).toBeUndefined()
    const target = parseNote('companies/Digital District Zwolle.md', files['companies/Digital District Zwolle.md'])
    expect(target.content).toContain('Netwerk van digitale bedrijven.\n\n## DDZ\n\nMijn bestuursrol.')
    expect(files['companies/Digital District Zwolle.md']).toContain('aliases:\n  - DDZ')
    // The relation between the two notes would point at the note itself, so it is gone
    expect(target.relations).toEqual([])

    const meeting = parseNote('meetings/Ledenavond.md', files['meetings/Ledenavond.md'])
    expect(meeting.relations).toEqual([{ target: 'Digital District Zwolle', type: 'part_of' }])
    expect(meeting.content).toContain('[[Digital District Zwolle|DDZ]]')
    expect(files['notes/Other.md']).toBe('---\ntype: note\n---\nNiets.\n')
  })

  it('works the other way round too', async () => {
    await merge('companies/Digital District Zwolle.md', 'areas/DDZ.md')
    expect(files['companies/Digital District Zwolle.md']).toBeUndefined()
    expect(parseNote('areas/DDZ.md', files['areas/DDZ.md']).relations).toEqual([])
    expect(files['meetings/Ledenavond.md']).toContain('[[DDZ]]')
  })

  it('refuses to merge a note into itself', async () => {
    const res = await merge('areas/DDZ.md', 'areas/DDZ.md')
    expect(res.status).toBe(400)
  })
})
