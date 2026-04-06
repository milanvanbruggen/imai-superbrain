import type { VaultClient } from './vault-client'

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

  async getMarkdownTree(): Promise<TreeFile[]> {
    const branch = this.config.branch ?? 'main'
    const branchRes = await fetch(`${this.base}/branches/${branch}`, { headers: this.headers })
    if (!branchRes.ok) throw new Error(`Failed to get branch: ${branchRes.status}`)
    const branchData = await branchRes.json()
    const treeSha = branchData.commit.sha

    const treeRes = await fetch(`${this.base}/git/trees/${treeSha}?recursive=1`, { headers: this.headers })
    if (!treeRes.ok) throw new Error(`Failed to get tree: ${treeRes.status}`)
    const tree = await treeRes.json()

    const EXCLUDED = new Set(['CLAUDE.md', 'memory.md'])
    const EXCLUDED_DIRS = new Set(['Claude', 'templates', 'archive'])
    return (tree.tree as any[])
      .filter((item: any) => {
        if (item.type !== 'blob' || !item.path.endsWith('.md')) return false
        const parts = item.path.split('/')
        if (parts.length === 1 && EXCLUDED.has(parts[0])) return false
        if (EXCLUDED_DIRS.has(parts[0])) return false
        return true
      })
      .map((item: any) => ({ path: item.path, sha: item.sha }))
  }

  async getSystemFiles(dirs: string[]): Promise<{ path: string }[]> {
    const branch = this.config.branch ?? 'main'
    const branchRes = await fetch(`${this.base}/branches/${branch}`, { headers: this.headers })
    if (!branchRes.ok) throw new Error(`Failed to get branch: ${branchRes.status}`)
    const branchData = await branchRes.json()
    const treeSha = branchData.commit.sha

    const treeRes = await fetch(`${this.base}/git/trees/${treeSha}?recursive=1`, { headers: this.headers })
    if (!treeRes.ok) throw new Error(`Failed to get tree: ${treeRes.status}`)
    const tree = await treeRes.json()

    const dirSet = new Set(dirs)
    return (tree.tree as any[])
      .filter((item: any) => {
        if (item.type !== 'blob' || !item.path.endsWith('.md')) return false
        const topDir = item.path.split('/')[0]
        return dirSet.has(topDir)
      })
      .map((item: any) => ({ path: item.path }))
  }

  async readFile(path: string): Promise<FileContent> {
    const res = await fetch(`${this.base}/contents/${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`Failed to read file ${path}: ${res.status}`)
    const data = await res.json()
    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    return { content, sha: data.sha }
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
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
