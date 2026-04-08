import { VaultReader } from '../vault-reader.js'

const MAX_CHARS = 2000

function truncateContent(content: string): { content: string; truncated?: true } {
  if (content.length <= MAX_CHARS) return { content }
  const lastNewline = content.lastIndexOf('\n', MAX_CHARS - 1)
  const cutAt = lastNewline > 0 ? lastNewline + 1 : MAX_CHARS
  return { content: content.slice(0, cutAt), truncated: true }
}

export function createReadTool(vault: VaultReader) {
  return {
    name: 'read_note',
    description: 'Read a note by its relative path or title. Returns truncated content by default (2000 chars). Pass full=true for complete content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path, e.g. people/Milan.md' },
        title: { type: 'string', description: 'Note title or stem (case-insensitive)' },
        full: { type: 'boolean', description: 'Return full content without truncation (default: false)' },
      },
    },
    async execute({ path, title, full }: { path?: string; title?: string; full?: boolean }) {
      const note = path
        ? vault.getNoteByPath(path)
        : vault.getNoteByTitle(title ?? '')
      if (!note) return { error: 'Note not found' }

      const { content, truncated } = full
        ? { content: note.content, truncated: undefined }
        : truncateContent(note.content)

      return {
        path: note.path,
        title: note.title,
        type: note.type,
        tags: note.tags,
        content,
        ...(truncated ? { truncated } : {}),
      }
    },
  }
}
