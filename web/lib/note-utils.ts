/**
 * Extracts the stem (filename without .md extension) from a vault path.
 * Strips `[` and `]` to prevent wikilink injection in commit messages.
 */
export function getStemFromPath(filePath: string): string {
  return (
    filePath.split('/').pop()?.replace(/\.md$/, '').replace(/[[\]]+/g, ' ').trim() ?? filePath
  )
}

/**
 * Throws if the path is not a safe relative vault path.
 * Guards against path traversal, absolute paths, and empty inputs.
 */
export function validateVaultPath(path: string): void {
  if (!path || typeof path !== 'string') throw new Error('Invalid vault path: empty')
  if (path.startsWith('/')) throw new Error(`Invalid vault path: absolute path "${path}"`)
  const segments = path.split('/')
  if (segments.some(s => s === '..' || s === '.')) {
    throw new Error(`Invalid vault path: traversal in "${path}"`)
  }
}
