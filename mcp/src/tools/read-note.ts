import { VaultReader } from '../vault-reader.js'

export function createReadTool(vault: VaultReader) {
  return {
    name: 'read_note',
    description: 'Read a note by its relative path or title',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path, e.g. people/Milan.md' },
        title: { type: 'string', description: 'Note title or stem (case-insensitive)' },
      },
    },
    async execute({ path, title }: { path?: string; title?: string }) {
      const note = path
        ? vault.getNoteByPath(path)
        : vault.getNoteByTitle(title ?? '')
      if (!note) return { error: 'Note not found' }
      return {
        path: note.path,
        title: note.title,
        type: note.type,
        tags: note.tags,
        content: note.content,
      }
    },
  }
}
