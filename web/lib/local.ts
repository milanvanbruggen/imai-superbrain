import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
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

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const fullPath = this.resolveSafe(path)
    const content = await readFile(fullPath, 'utf-8')
    return { content, sha: sha1(content) }
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
    return fullPath
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(dir)
    await Promise.all(
      entries.map(async entry => {
        const fullPath = join(dir, entry)
        const info = await stat(fullPath)
        if (info.isDirectory()) {
          results.push(...(await this.findMarkdownFiles(fullPath)))
        } else if (entry.endsWith('.md')) {
          results.push(fullPath)
        }
      })
    )
    return results
  }
}
