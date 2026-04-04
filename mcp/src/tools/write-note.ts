import { VaultReader } from '../vault-reader.js'

export function createWriteTool(vault: VaultReader) {
  return {
    name: 'write_note',
    description: 'Create or update a note at the given path',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path, e.g. notes/idea.md' },
        content: { type: 'string', description: 'Full markdown content of the note' },
      },
      required: ['path', 'content'],
    },
    async execute({ path, content }: { path: string; content: string }) {
      vault.writeNote(path, content)
      return { ok: true, path }
    },
  }
}
