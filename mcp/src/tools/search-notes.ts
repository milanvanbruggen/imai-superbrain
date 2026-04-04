import { VaultReader } from '../vault-reader.js'

export function createSearchTool(vault: VaultReader) {
  return {
    name: 'search_notes',
    description: 'Full-text search across all vault notes by title or content',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute({ query }: { query: string }) {
      const lower = query.toLowerCase()
      const results = vault
        .getAllNotes()
        .filter(
          n =>
            n.title.toLowerCase().includes(lower) ||
            n.content.toLowerCase().includes(lower)
        )
        .slice(0, 10)
        .map(n => ({ path: n.path, title: n.title, type: n.type }))
      return { results }
    },
  }
}
