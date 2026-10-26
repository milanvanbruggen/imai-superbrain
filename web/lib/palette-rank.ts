// How the command palette orders what you type against

/**
 * Ranks an item for the typed search: the title (first keyword) exactly, then titles that start
 * with it (shorter first, so "Persoon 4" beats "Persoon 49"), then titles that contain it, then
 * matches on type and tags. Every word typed has to match somewhere.
 */
export function rankPaletteItem(value: string, search: string, keywords?: string[]): number {
  const q = search.trim().toLowerCase()
  if (!q) return 1
  const title = (keywords?.[0] ?? value).toLowerCase()
  if (title === q) return 1
  if (title.startsWith(q)) return 0.9 - Math.min(title.length, 200) / 1000
  const at = title.indexOf(q)
  if (at >= 0) return 0.7 - Math.min(at, 100) / 1000
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  return q.split(/\s+/).every(w => haystack.includes(w)) ? 0.3 : 0
}
