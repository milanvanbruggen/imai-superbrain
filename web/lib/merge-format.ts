// How the body of a merged note is put together. Shared by the merge route and the merge preview,
// so the preview shows exactly what gets written.

export interface MergeSource {
  title: string
  content: string
  /** An inbox note is an update to the target; any other note is a note in its own right */
  inbox: boolean
  /** YYYY-MM-DD, for the date on an update */
  date?: string
}

const NL_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export function formatNlDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return dateStr
  return `${day} ${NL_MONTHS[month - 1]} ${year}`
}

/** An inbox update as a dated bullet; a header line like "Update voor [[X]]:" is dropped. */
export function formatAsBullet(content: string, dateStr: string): string {
  const cleaned = content
    .replace(/^(?:update|wijziging|change|verzoek)[^\n]*:\s*/im, '')
    .replace(/^\s*\n/, '')
    .trim()
  if (!cleaned) return ''
  const prefix = `- **${formatNlDate(dateStr)}** — `
  // If content is multi-paragraph, keep first paragraph on the bullet line and indent the rest
  const [firstPara, ...rest] = cleaned.split(/\n\n+/)
  const bullet = prefix + firstPara.replace(/\n/g, ' ')
  return rest.length > 0 ? bullet + '\n\n  ' + rest.join('\n\n  ') : bullet
}

/**
 * A whole note as a section of the note it is merged into: a "## Title" heading, then its body.
 * A first heading that only repeats the title is dropped, and the note's own headings move down
 * so they sit under the new section (its top level becomes ###).
 */
export function formatAsSection(title: string, content: string): string {
  const lines = content.trim().split('\n')
  const first = lines[0]?.match(/^#{1,6}\s+(.*)$/)
  if (first && first[1].trim().toLowerCase() === title.trim().toLowerCase()) lines.shift()

  let inFence = false
  const levels: number[] = []
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence) {
      const h = line.match(/^(#{1,6})\s/)
      if (h) levels.push(h[1].length)
    }
  }
  const shift = levels.length ? 3 - Math.min(...levels) : 0
  inFence = false
  const body = lines.map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line }
    if (inFence || shift === 0) return line
    return line.replace(/^(#{1,6})(?=\s)/, h => '#'.repeat(Math.min(6, Math.max(1, h.length + shift))))
  }).join('\n').trim()

  return body ? `## ${title}\n\n${body}` : ''
}

/** The body of the target after merging the source into it. */
export function mergedBody(source: MergeSource, targetContent: string): string {
  const target = targetContent.trim()
  const added = !source.content.trim()
    ? ''
    : source.inbox
      ? formatAsBullet(source.content.trim(), source.date ?? new Date().toISOString().slice(0, 10))
      : formatAsSection(source.title, source.content)
  if (!added) return target
  return target ? `${target}\n\n${added}` : added
}
