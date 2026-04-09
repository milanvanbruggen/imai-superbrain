import matter from 'gray-matter'
import { VaultNote, GraphNode, GraphEdge, VaultGraph, TypedRelation } from './types'

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

const SYSTEM_PATHS = new Set(['CLAUDE.md', 'memory.md'])

function systemType(path: string): 'system' | 'template' | null {
  if (SYSTEM_PATHS.has(path) || path.startsWith('Claude/')) return 'system'
  if (path.startsWith('templates/')) return 'template'
  return null
}

function stemToTitle(stem: string): string {
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function parseNote(path: string, raw: string): VaultNote {
  const { data, content } = matter(raw)
  const stem = path.split('/').pop()!.replace(/\.md$/, '')

  const wikilinksInBody = new Set<string>()
  const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '')
  const re = new RegExp(WIKILINK_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(contentWithoutComments)) !== null) {
    wikilinksInBody.add(match[1])
  }

  const relations: TypedRelation[] = (data.relations ?? [])
    .filter((r: any) => typeof r.target === 'string')
    .map((r: any) => ({
      target: r.target.replace(/^\[\[|\]\]$/g, ''),
      type: typeof r.type === 'string' && r.type.trim() ? r.type.trim() : undefined,
    }))

  const email = typeof data.email === 'string' ? data.email : undefined

  return {
    path,
    stem,
    title: data.title ?? stemToTitle(stem),
    type: systemType(path) ?? (typeof data.type === 'string' && data.type.trim() ? data.type.trim() : 'note'),
    tags: data.tags ?? [],
    date: data.date instanceof Date
      ? data.date.toISOString().slice(0, 10)
      : typeof data.date === 'string'
        ? data.date
        : null,
    email,
    content,
    relations,
    wikilinks: [...wikilinksInBody],
  }
}

export function resolveWikilink(
  link: string,
  notes: { stem: string; path: string }[]
): string | null {
  const lower = link.toLowerCase()
  const match = notes.find(n => n.stem.toLowerCase() === lower)
  return match ? match.stem.toLowerCase() : null
}

export function buildGraph(files: [path: string, raw: string][]): VaultGraph {
  const parsed = files.map(([path, raw]) => parseNote(path, raw))
  const notesByPath: Record<string, VaultNote> = {}
  const notesByStem: Record<string, VaultNote> = {}

  for (const note of parsed) {
    notesByPath[note.path] = note
    notesByStem[note.stem.toLowerCase()] = note
  }

  const stemIndex = parsed.map(n => ({ stem: n.stem.toLowerCase(), path: n.path }))

  // Count stems to detect duplicates
  const stemCounts: Record<string, number> = {}
  for (const n of parsed) {
    const key = n.stem.toLowerCase()
    stemCounts[key] = (stemCounts[key] ?? 0) + 1
  }

  const nodes: GraphNode[] = parsed.map(note => ({
    id: note.stem.toLowerCase(),
    path: note.path,
    title: note.title,
    type: note.type,
    tags: note.tags,
    hasDuplicateStem: (stemCounts[note.stem.toLowerCase()] ?? 0) > 1,
  }))

  const edges: GraphEdge[] = []
  const typedPairs = new Set<string>()

  // Add edges from frontmatter relations first (typed if rel.type set, untyped otherwise)
  for (const note of parsed) {
    const sourceId = note.stem.toLowerCase()
    for (const rel of note.relations) {
      const targetId = resolveWikilink(rel.target, stemIndex)
      if (targetId) {
        edges.push({ source: sourceId, target: targetId, typed: !!rel.type, relationType: rel.type })
        typedPairs.add(`${sourceId}→${targetId}`)
      }
    }
  }

  // Add untyped edges from body wikilinks (suppress if typed edge already covers same pair)
  for (const note of parsed) {
    const sourceId = note.stem.toLowerCase()
    for (const link of note.wikilinks) {
      const targetId = resolveWikilink(link, stemIndex)
      if (targetId && !typedPairs.has(`${sourceId}→${targetId}`)) {
        edges.push({ source: sourceId, target: targetId, typed: false })
      }
    }
  }

  return { nodes, edges, notesByPath, notesByStem, builtAt: Date.now() }
}
