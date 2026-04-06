import matter from 'gray-matter'

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

export interface ParsedNote {
  path: string
  stem: string
  title: string
  type: string
  tags: string[]
  content: string
  wikilinks: string[]
}

export function extractWikilinks(text: string): string[] {
  const seen = new Set<string>()
  const re = new RegExp(WIKILINK_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    seen.add(match[1])
  }
  return [...seen]
}

function stemToTitle(stem: string): string {
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function parseMarkdown(path: string, raw: string): ParsedNote {
  const { data, content } = matter(raw)
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  return {
    path,
    stem,
    title: data.title ?? stemToTitle(stem),
    type: data.type ?? 'note',
    tags: Array.isArray(data.tags) ? data.tags : [],
    content,
    wikilinks: extractWikilinks(content),
  }
}

export function resolveWikilink(
  link: string,
  notes: { stem: string; path: string }[]
): { stem: string; path: string } | null {
  const lower = link.toLowerCase()
  return notes.find(n => n.stem.toLowerCase() === lower) ?? null
}
