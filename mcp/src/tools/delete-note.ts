import { VaultReader } from '../vault-reader.js'

export function createDeleteTool(vault: VaultReader) {
  return {
    name: 'delete_note',
    description: 'Permanently delete a note at the given path. Use with caution — this cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path of the note to delete, e.g. notes/old-idea.md' },
      },
      required: ['path'],
    },
    async execute({ path }: { path: string }) {
      vault.deleteNote(path)
      return { ok: true, deleted: path }
    },
  }
}
