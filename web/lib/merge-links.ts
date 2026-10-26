// After a merge the merged-away note is gone: links to it in other notes are pointed at the note that stays.

const LINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const BARE_TARGET_RE = /^(\s*-?\s*target:\s*)(["']?)([^"'\n]+?)\2(\s*)$/gm

/** True when a link (as written inside [[ ]]) points at the note at this path. */
export function linksTo(link: string, path: string): boolean {
  const l = link.trim().toLowerCase()
  const noExt = path.replace(/\.md$/, '').toLowerCase()
  const stem = noExt.split('/').pop()!
  return l === stem || l === noExt || l === path.toLowerCase()
}

/**
 * Points every link to the note at fromPath at toStem instead. In the body a link keeps the text it
 * showed ([[DDZ]] becomes [[Digital District Zwolle|DDZ]]); in the frontmatter relations get the
 * new target, quoted so YAML doesn't read the brackets as a list. Returns the file unchanged when it has no such link.
 */
export function retargetLinks(raw: string, fromPath: string, toStem: string): string {
  const head = raw.match(FRONTMATTER_RE)?.[0] ?? ''
  const body = raw.slice(head.length)
  const swap = (keepText: boolean) => (match: string, link: string, heading = '', alias = '') => {
    if (!linksTo(link, fromPath)) return match
    const shown = alias || (keepText && link.trim().toLowerCase() !== toStem.toLowerCase() ? `|${link.trim()}` : '')
    return `[[${toStem}${heading}${shown}]]`
  }
  const newHead = head
    .replace(LINK_RE, swap(false))
    .replace(BARE_TARGET_RE, (match, prefix: string, quote: string, link: string, rest: string) =>
      link.startsWith('[[') || !linksTo(link, fromPath) ? match : `${prefix}${quote || '"'}[[${toStem}]]${quote || '"'}${rest}`)
  return newHead + body.replace(LINK_RE, swap(true))
}
