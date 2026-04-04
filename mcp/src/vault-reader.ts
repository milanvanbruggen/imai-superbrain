import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join, relative, normalize, dirname } from 'path'
import { parseMarkdown, ParsedNote } from './parser.js'

export class VaultReader {
  private vaultPath: string
  private notes: ParsedNote[] = []

  constructor() {
    this.vaultPath = process.env.VAULT_PATH ?? ''
    if (!this.vaultPath) {
      throw new Error('VAULT_PATH environment variable is required')
    }
    this.reload()
  }

  reload(): void {
    const files = this.findMarkdownFiles(this.vaultPath)
    this.notes = files.map(fullPath => {
      const raw = readFileSync(fullPath, 'utf-8')
      const relPath = relative(this.vaultPath, fullPath)
      return parseMarkdown(relPath, raw)
    })
  }

  private findMarkdownFiles(dir: string): string[] {
    const results: string[] = []
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      if (statSync(fullPath).isDirectory()) {
        results.push(...this.findMarkdownFiles(fullPath))
      } else if (entry.endsWith('.md')) {
        results.push(fullPath)
      }
    }
    return results
  }

  getAllNotes(): ParsedNote[] {
    return this.notes
  }

  getNoteByPath(path: string): ParsedNote | undefined {
    return this.notes.find(n => n.path === path)
  }

  getNoteByTitle(title: string): ParsedNote | undefined {
    const lower = title.toLowerCase()
    return this.notes.find(
      n => n.title.toLowerCase() === lower || n.stem.toLowerCase() === lower
    )
  }

  writeNote(path: string, content: string): void {
    const fullPath = join(this.vaultPath, path)
    // Prevent path traversal
    if (!normalize(fullPath).startsWith(normalize(this.vaultPath) + '/') &&
        normalize(fullPath) !== normalize(this.vaultPath)) {
      throw new Error(`Path traversal detected: ${path}`)
    }
    // Create parent directories if needed
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
    this.reload()
  }

  getStemIndex(): { stem: string; path: string }[] {
    return this.notes.map(n => ({ stem: n.stem, path: n.path }))
  }
}
