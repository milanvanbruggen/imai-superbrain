import { GitHubVaultClient } from './github'
import { LocalVaultClient } from './local'

export interface VaultClient {
  getMarkdownTree(): Promise<{ path: string; sha: string }[]>
  readFile(path: string): Promise<{ content: string; sha: string }>
  writeFile(path: string, content: string, sha: string | null, message: string): Promise<void>
}

export function getVaultClient(): VaultClient {
  const vaultPath = process.env.VAULT_PATH
  if (vaultPath) {
    return new LocalVaultClient(vaultPath) as unknown as VaultClient
  }

  const pat = process.env.GITHUB_PAT
  const owner = process.env.GITHUB_VAULT_OWNER
  const repo = process.env.GITHUB_VAULT_REPO
  if (pat && owner && repo) {
    return new GitHubVaultClient({
      pat,
      owner,
      repo,
      branch: process.env.GITHUB_VAULT_BRANCH,
    })
  }

  throw new Error(
    'No vault configured. Set VAULT_PATH for local mode, or GITHUB_PAT + GITHUB_VAULT_OWNER + GITHUB_VAULT_REPO for GitHub mode.'
  )
}
