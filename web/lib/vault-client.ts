import { GitHubVaultClient } from './github'
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
  const settings = resolveVaultSettings()

  if (settings.mode === 'local' && settings.vaultPath) {
    return new LocalVaultClient(settings.vaultPath)
  }

  if (settings.mode === 'github' && settings.pat && settings.owner && settings.repo) {
    return new GitHubVaultClient({
      pat: settings.pat,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch,
    })
  }

  throw new Error('vault_not_configured')
}
