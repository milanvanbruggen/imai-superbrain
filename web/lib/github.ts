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

export class GitHubVaultClient {
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

    return (tree.tree as any[])
      .filter((item: any) => item.type === 'blob' && item.path.endsWith('.md'))
      .map((item: any) => ({ path: item.path, sha: item.sha }))
  }

  async readFile(path: string): Promise<FileContent> {
    const res = await fetch(`${this.base}/contents/${path}`, { headers: this.headers })
    if (!res.ok) throw new Error(`Failed to read file ${path}: ${res.status}`)
    const data = await res.json()
    const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    return { content, sha: data.sha }
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

export function getVaultClient(): GitHubVaultClient {
  const pat = process.env.GITHUB_PAT
  const owner = process.env.GITHUB_VAULT_OWNER
  const repo = process.env.GITHUB_VAULT_REPO
  if (!pat || !owner || !repo) {
    throw new Error('Missing GITHUB_PAT, GITHUB_VAULT_OWNER, or GITHUB_VAULT_REPO env vars')
  }
  return new GitHubVaultClient({
    pat,
    owner,
    repo,
    branch: process.env.GITHUB_VAULT_BRANCH, // optional, defaults to 'main'
  })
}
