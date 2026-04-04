import { VaultReader } from '../vault-reader.js'
import { resolveWikilink } from '../parser.js'

export function createGetRelatedTool(vault: VaultReader) {
  return {
    name: 'get_related',
    description: 'Get all notes that link to or from a given note',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path of the note' },
      },
      required: ['path'],
    },
    async execute({ path }: { path: string }) {
      const note = vault.getNoteByPath(path)
      if (!note) return { error: 'Note not found' }

      const index = vault.getStemIndex()

      const outgoing = note.wikilinks
        .map(link => resolveWikilink(link, index))
        .filter((n): n is { stem: string; path: string } => n !== null)
        .map(n => n.path)

      const incoming = vault
        .getAllNotes()
        .filter(n =>
          n.wikilinks.some(link => resolveWikilink(link, index)?.path === path)
        )
        .map(n => n.path)

      return { outgoing, incoming }
    },
  }
}
