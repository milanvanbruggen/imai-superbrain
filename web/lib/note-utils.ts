/**
 * Extracts the stem (filename without .md extension) from a vault path.
 * Strips `[` and `]` to prevent wikilink injection in commit messages.
 */
export function getStemFromPath(filePath: string): string {
  return (
    filePath.split('/').pop()?.replace(/\.md$/, '').replace(/[[\]]+/g, ' ').trim() ?? filePath
  )
}
