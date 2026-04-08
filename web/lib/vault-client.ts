import { GitHubVaultClient } from './github'
import { GitLabVaultClient } from './gitlab'
import { LocalVaultClient } from './local'
import { resolveVaultSettings } from './vault-config'

export interface VaultClient {
  getMarkdownTree(): Promise<{ path: string; sha: string }[]>
  getSystemFiles(dirs: string[]): Promise<{ path: string }[]>
  readFile(path: string): Promise<{ content: string; sha: string }>
  writeFile(path: string, content: string, sha: string | null, message: string): Promise<void>
  deleteFile(path: string, sha: string, message: string): Promise<void>
}

export function getVaultClient(): VaultClient {
  const { mode, remote, local } = resolveVaultSettings()

  if (mode === 'local' && local) {
    return new LocalVaultClient(local.path)
  }

  if (mode === 'github' && remote?.provider === 'github') {
    return new GitHubVaultClient({
      pat: remote.token,
      owner: remote.owner,
      repo: remote.repo,
      branch: remote.branch,
    })
  }

  if (mode === 'gitlab' && remote?.provider === 'gitlab') {
    return new GitLabVaultClient(remote)
  }

  throw new Error('vault_not_configured')
}
