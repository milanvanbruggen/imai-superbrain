import { VaultReader } from '../vault-reader.js'

const MAX_EXCERPT = 200
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

function buildExcerpt(content: string, query: string): string {
  if (!content) return ''

  const lower = content.toLowerCase()
  const pos = lower.indexOf(query.toLowerCase())

  // Title-only match: return start of content
  if (pos === -1) {
    if (content.length <= MAX_EXCERPT) return content
    return content.slice(0, MAX_EXCERPT) + '...'
  }

  // Centre the excerpt window on the match, capped at MAX_EXCERPT chars
  const matchLen = query.length
  const pad = Math.max(0, Math.floor((MAX_EXCERPT - matchLen) / 2))
  const start = Math.max(0, pos - pad)
  const end = Math.min(content.length, start + MAX_EXCERPT)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''
  return prefix + content.slice(start, end) + suffix
}

export function createGetContextTool(vault: VaultReader) {
  return {
    name: 'get_context',
    description: 'Search notes and return matching results with excerpts and outgoing links in one call. More efficient than search_notes + multiple read_note calls.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term (case-insensitive)' },
        limit: { type: 'number', description: 'Max results (default: 5, max: 10)' },
      },
      required: ['query'],
    },
    async execute({ query, limit }: { query: string; limit?: number }) {
      const cap = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const lower = query.toLowerCase()
      const results = vault
        .getAllNotes()
        .filter(
          n =>
            n.title.toLowerCase().includes(lower) ||
            n.content.toLowerCase().includes(lower)
        )
        .slice(0, cap)
        .map(n => ({
          path: n.path,
          title: n.title,
          type: n.type,
          tags: n.tags,
          excerpt: buildExcerpt(n.content, query),
          links: n.wikilinks,
        }))
      return { results }
    },
  }
}
