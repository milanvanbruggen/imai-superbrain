import type { VaultClient } from './vault-client'
import { validateVaultPath } from './note-utils'

interface GitHubClientConfig {
  pat: string
  owner: string
  repo: string
  branch?: string
}

interface TreeFile {
  path: string
  sha: string
}

interface FileContent {
  content: string
  sha: string
}

interface GitHubTreeItem {
  path: string
  type: string
  sha: string
}

// ETag cache for GET requests, shared across clients within a server instance.
// A conditional request answered with 304 Not Modified does not count against
// GitHub's rate limit, so polling an unchanged vault is effectively free.
const MAX_ETAG_ENTRIES = 5000
const etagCache = new Map<string, { etag: string; body: unknown }>()

function rememberEtag(url: string, etag: string, body: unknown): void {
  etagCache.delete(url)
  etagCache.set(url, { etag, body })
  if (etagCache.size > MAX_ETAG_ENTRIES) {
    etagCache.delete(etagCache.keys().next().value!)
  }
}

/** Builds an error that keeps GitHub's own explanation (rate limit, missing permission, SSO). */
async function githubError(prefix: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await res.json()
    if (body?.message) detail = body.message
  } catch {}
  const remaining = res.headers?.get('x-ratelimit-remaining')
  const reset = res.headers?.get('x-ratelimit-reset')
  if (remaining === '0' && reset) {
    const resetAt = new Date(Number(reset) * 1000).toISOString().slice(11, 16)
    detail = `GitHub API rate limit exceeded, resets at ${resetAt} UTC`
  }
  return new Error(`${prefix}: ${res.status}${detail ? ` (${detail})` : ''}`)
}

export class GitHubVaultClient implements VaultClient {
  private base: string
  private headers: Record<string, string>

  constructor(private config: GitHubClientConfig) {
    this.base = `https://api.github.com/repos/${config.owner}/${config.repo}`
    this.headers = {
      Authorization: `Bearer ${config.pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  private async getJson<T>(url: string, errorPrefix: string): Promise<T> {
    const cached = etagCache.get(url)
    const headers = cached ? { ...this.headers, 'If-None-Match': cached.etag } : this.headers
    const res = await fetch(url, { headers })
    if (res.status === 304 && cached) return cached.body as T
    if (!res.ok) throw await githubError(errorPrefix, res)
    const body = await res.json()
    const etag = res.headers?.get('etag')
    if (etag) rememberEtag(url, etag, body)
    return body as T
  }

  private async getTree(): Promise<GitHubTreeItem[]> {
    const branch = this.config.branch ?? 'main'
    const branchData = await this.getJson<{ commit: { sha: string } }>(`${this.base}/branches/${branch}`, 'Failed to get branch')
    const treeSha = branchData.commit.sha
    const tree = await this.getJson<{ tree: GitHubTreeItem[] }>(`${this.base}/git/trees/${treeSha}?recursive=1`, 'Failed to get tree')
    return tree.tree
  }

  async getMarkdownTree(): Promise<TreeFile[]> {
    const tree = await this.getTree()
    return tree
      .filter(item => {
        if (item.type !== 'blob' || !item.path.endsWith('.md')) return false
        if (item.path.split('/')[0] === 'archive') return false
        return true
      })
      .map(item => ({ path: item.path, sha: item.sha }))
  }

  async getSystemFiles(dirs: string[]): Promise<{ path: string }[]> {
    const tree = await this.getTree()
    const dirSet = new Set(dirs)
    return tree
      .filter(item => {
        if (item.type !== 'blob' || !item.path.endsWith('.md')) return false
        const topDir = item.path.split('/')[0]
        return dirSet.has(topDir)
      })
      .map(item => ({ path: item.path }))
  }

  async readFile(path: string): Promise<FileContent> {
    validateVaultPath(path)
    const data = await this.getJson<{ content: string; sha: string }>(`${this.base}/contents/${path}`, `Failed to read file ${path}`)
    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    return { content, sha: data.sha }
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    validateVaultPath(path)
    const res = await fetch(`${this.base}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`Failed to delete file ${path}: ${JSON.stringify(err)}`)
    }
  }

  async writeFile(path: string, content: string, sha: string | null, message: string): Promise<void> {
    validateVaultPath(path)
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content).toString('base64'),
    }
    if (sha) body.sha = sha

    const res = await fetch(`${this.base}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`Failed to write file ${path}: ${JSON.stringify(err)}`)
    }
  }
}
