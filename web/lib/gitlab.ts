import type { VaultClient } from './vault-client'
import type { GitLabRemote } from './vault-config'

export class GitLabVaultClient implements VaultClient {
  private base: string
  private branch: string
  private headers: Record<string, string>

  constructor(private config: GitLabRemote) {
    const baseUrl = config.url ?? 'https://gitlab.com'
    const projectId = encodeURIComponent(`${config.namespace}/${config.project}`)
    this.base = `${baseUrl}/api/v4/projects/${projectId}`
    this.branch = config.branch ?? 'main'
    this.headers = { 'PRIVATE-TOKEN': config.token }
  }

  async getMarkdownTree(): Promise<{ path: string; sha: string }[]> {
    const files: { path: string; sha: string }[] = []
    let page = 1

    while (true) {
      const res = await fetch(
        `${this.base}/repository/tree?recursive=true&ref=${this.branch}&per_page=100&page=${page}`,
        { headers: this.headers }
      )
      if (!res.ok) throw new Error(`Failed to get tree: ${res.status}`)
      const items: any[] = await res.json()
      if (!Array.isArray(items) || items.length === 0) break

      for (const item of items) {
        if (item.type !== 'blob' || !item.path.endsWith('.md')) continue
        if (item.path.split('/')[0] === 'archive') continue
        files.push({ path: item.path, sha: item.id })
      }

      if (items.length < 100) break
      page++
    }

    return files
  }

  async getSystemFiles(dirs: string[]): Promise<{ path: string }[]> {
    const tree = await this.getMarkdownTree()
    const dirSet = new Set(dirs)
    return tree
      .filter(f => dirSet.has(f.path.split('/')[0]))
      .map(f => ({ path: f.path }))
  }

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const encodedPath = encodeURIComponent(path)
    const res = await fetch(
      `${this.base}/repository/files/${encodedPath}?ref=${this.branch}`,
      { headers: this.headers }
    )
    if (!res.ok) throw new Error(`Failed to read file ${path}: ${res.status}`)
    const data = await res.json()
    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    return { content, sha: data.blob_id }
  }

  async writeFile(path: string, content: string, sha: string | null, message: string): Promise<void> {
    const encodedPath = encodeURIComponent(path)
    const method = sha ? 'PUT' : 'POST'
    const res = await fetch(`${this.base}/repository/files/${encodedPath}`, {
      method,
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch: this.branch,
        content,
        commit_message: message,
        encoding: 'text',
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Failed to write file ${path}: ${JSON.stringify(err)}`)
    }
  }

  async deleteFile(path: string, _sha: string, message: string): Promise<void> {
    const encodedPath = encodeURIComponent(path)
    const res = await fetch(`${this.base}/repository/files/${encodedPath}`, {
      method: 'DELETE',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: this.branch, commit_message: message }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Failed to delete file ${path}: ${JSON.stringify(err)}`)
    }
  }
}
