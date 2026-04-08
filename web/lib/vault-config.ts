import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface VaultConfigFile {
  mode?: 'local' | 'github'
  vaultPath?: string
  owner?: string
  repo?: string
  branch?: string
  syncEnabled?: boolean
}

const CONFIG_PATH = join(process.cwd(), 'vault-config.json')

/** Returns true when running on Vercel (or similar serverless with read-only fs). */
export function isServerless(): boolean {
  return !!process.env.VERCEL
}

export function readVaultConfig(): VaultConfigFile {
  try {
    if (!existsSync(CONFIG_PATH)) return {}
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export function writeVaultConfig(config: VaultConfigFile): void {
  if (isServerless()) {
    throw new Error(
      'Configuration cannot be saved in a serverless environment. ' +
      'Set GITHUB_PAT, GITHUB_VAULT_OWNER, GITHUB_VAULT_REPO and GITHUB_VAULT_BRANCH ' +
      'as environment variables in your Vercel project settings instead.'
    )
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Resolve effective vault settings: vault-config.json overrides env vars */
export function resolveVaultSettings() {
  const file = readVaultConfig()

  const vaultPath = file.vaultPath || process.env.VAULT_PATH || undefined
  const owner = file.owner || process.env.GITHUB_VAULT_OWNER || undefined
  const repo = file.repo || process.env.GITHUB_VAULT_REPO || undefined
  const branch = file.branch || process.env.GITHUB_VAULT_BRANCH || 'main'
  const pat = process.env.GITHUB_PAT || undefined

  // Sync requires both a local path (to read/write filesystem) and GitHub credentials
  const syncCandidate = file.syncEnabled === true
    && !!vaultPath
    && !!owner && !!repo && !!pat
    && !process.env.VERCEL

  // Explicit mode from config file takes priority
  if (file.mode === 'local' && vaultPath) {
    return { mode: 'local' as const, vaultPath, owner, repo, branch, pat, syncEnabled: syncCandidate }
  }
  if (file.mode === 'github' && owner && repo) {
    return { mode: 'github' as const, vaultPath, owner, repo, branch, pat, syncEnabled: syncCandidate }
  }

  // Auto-detect from available values
  if (vaultPath) {
    return { mode: 'local' as const, vaultPath, owner, repo, branch, pat, syncEnabled: syncCandidate }
  }
  if (pat && owner && repo) {
    return { mode: 'github' as const, vaultPath, owner, repo, branch, pat, syncEnabled: syncCandidate }
  }

  return { mode: 'unconfigured' as const, vaultPath, owner, repo, branch, pat, syncEnabled: false } // unconfigured: sync requires a local path
}
