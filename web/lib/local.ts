import { readFile, writeFile, readdir, stat, mkdir, unlink } from 'fs/promises'
import { join, relative, normalize, dirname } from 'path'
import { createHash } from 'crypto'
import type { VaultClient } from './vault-client'

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

export class LocalVaultClient implements VaultClient {
  constructor(private vaultPath: string) {}

  async getMarkdownTree(): Promise<{ path: string; sha: string }[]> {
    const fullPaths = await this.findMarkdownFiles(this.vaultPath)
    return Promise.all(
      fullPaths.map(async fullPath => {
        const content = await readFile(fullPath, 'utf-8')
        const path = relative(this.vaultPath, fullPath)
        return { path, sha: sha1(content) }
      })
    )
  }

  async getSystemFiles(dirs: string[]): Promise<{ path: string }[]> {
    const results: { path: string }[] = []
    for (const dir of dirs) {
      const fullDir = join(this.vaultPath, dir)
      try {
        const entries = await readdir(fullDir)
        for (const entry of entries) {
          if (entry.endsWith('.md')) {
            results.push({ path: `${dir}/${entry}` })
          }
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }
    return results
  }

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const fullPath = this.resolveSafe(path)
    const content = await readFile(fullPath, 'utf-8')
    return { content, sha: sha1(content) }
  }

  async deleteFile(path: string, _sha: string, _message: string): Promise<void> {
    const fullPath = this.resolveSafe(path)
    await unlink(fullPath)
  }

  async writeFile(path: string, content: string, _sha: string | null, _message: string): Promise<void> {
    const fullPath = this.resolveSafe(path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  private resolveSafe(path: string): string {
    const fullPath = join(this.vaultPath, path)
    const normalizedFull = normalize(fullPath)
    const normalizedVault = normalize(this.vaultPath)
    if (!normalizedFull.startsWith(normalizedVault + '/') && normalizedFull !== normalizedVault) {
      throw new Error(`Path traversal detected: ${path}`)
    }
    return normalizedFull
  }

  private async findMarkdownFiles(dir: string, depth = 0): Promise<string[]> {
    const entries = await readdir(dir)
    const nested = await Promise.all(
      entries.map(async entry => {
        // Skip hidden dirs and archive at vault root
        if (entry.startsWith('.')) return []
        if (depth === 0 && entry === 'archive') return []
        const fullPath = join(dir, entry)
        const info = await stat(fullPath)
        if (info.isDirectory()) {
          return this.findMarkdownFiles(fullPath, depth + 1)
        } else if (entry.endsWith('.md')) {
          return [fullPath]
        }
        return []
      })
    )
    return nested.flat()
  }
}
