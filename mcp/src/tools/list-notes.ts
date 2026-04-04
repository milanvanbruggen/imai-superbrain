import { VaultReader } from '../vault-reader.js'

export function createListTool(vault: VaultReader) {
  return {
    name: 'list_notes',
    description: 'List vault notes, optionally filtered by folder prefix or tag',
    inputSchema: {
      type: 'object' as const,
      properties: {
        folder: { type: 'string', description: 'Filter by folder prefix, e.g. "people"' },
        tag: { type: 'string', description: 'Filter by tag' },
      },
    },
    async execute({ folder, tag }: { folder?: string; tag?: string }) {
      let notes = vault.getAllNotes()
      if (folder) notes = notes.filter(n => n.path.startsWith(folder + '/'))
      if (tag) notes = notes.filter(n => n.tags.includes(tag))
      return {
        notes: notes.map(n => ({
          path: n.path,
          title: n.title,
          type: n.type,
          tags: n.tags,
        })),
      }
    },
  }
}
