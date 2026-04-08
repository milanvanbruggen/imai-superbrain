import { VaultReader } from '../vault-reader.js'

export function createGetIndexTool(vault: VaultReader) {
  return {
    name: 'get_index',
    description: 'Get a compact structural map of the entire vault — all notes with their types, tags, and outgoing links. No content is returned. Use this to orient yourself before reading specific notes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    async execute() {
      return {
        notes: vault.getAllNotes().map(n => ({
          path: n.path,
          title: n.title,
          type: n.type,
          tags: n.tags,
          link_count: n.wikilinks.length,
          links: n.wikilinks,
        })),
      }
    },
  }
}
