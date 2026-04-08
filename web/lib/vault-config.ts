import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface GitHubRemote {
  provider: 'github'
  token: string
  owner: string
  repo: string
  branch?: string
}

export interface GitLabRemote {
  provider: 'gitlab'
  token: string
  namespace: string
  project: string
  branch?: string
  url?: string
}

export type RemoteConfig = GitHubRemote | GitLabRemote

export interface LocalConfig {
  path: string
}

export interface VaultConfigFile {
  remote?: RemoteConfig
  local?: LocalConfig
}

// Legacy format for backward compat on read
interface LegacyVaultConfigFile {
  mode?: string
  vaultPath?: string
  owner?: string
  repo?: string
  branch?: string
}

export type VaultMode = 'local' | 'github' | 'gitlab' | 'unconfigured'

export interface ResolvedVaultSettings {
  mode: VaultMode
  remote?: RemoteConfig
  local?: LocalConfig
  syncEnabled: boolean
}

const CONFIG_PATH = join(process.cwd(), 'vault-config.json')

export function isServerless(): boolean {
  return !!process.env.VERCEL
}

function parseLegacyConfig(raw: LegacyVaultConfigFile): VaultConfigFile {
  const result: VaultConfigFile = {}
  if (raw.owner && raw.repo) {
    result.remote = {
      provider: 'github',
      token: process.env.GITHUB_PAT ?? '',
      owner: raw.owner,
      repo: raw.repo,
      branch: raw.branch ?? 'main',
    }
  }
  if (raw.vaultPath) {
    result.local = { path: raw.vaultPath }
  }
  return result
}

export function readVaultConfig(): VaultConfigFile {
  // 1. vault-config.json on disk
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      // Detect old format by top-level 'owner' or 'mode' field
      if ('owner' in raw || 'mode' in raw) {
        return parseLegacyConfig(raw as LegacyVaultConfigFile)
      }
      return raw as VaultConfigFile
    }
  } catch {
    // fall through
  }

  // 2. VAULT_CONFIG env var (JSON)
  if (process.env.VAULT_CONFIG) {
    try {
      return JSON.parse(process.env.VAULT_CONFIG) as VaultConfigFile
    } catch {
      // fall through
    }
  }

  // 3. Legacy GITHUB_* env vars
  const pat = process.env.GITHUB_PAT
  const owner = process.env.GITHUB_VAULT_OWNER
  const repo = process.env.GITHUB_VAULT_REPO
  const branch = process.env.GITHUB_VAULT_BRANCH ?? 'main'
  const vaultPath = process.env.VAULT_PATH

  if (pat && owner && repo) {
    return {
      remote: { provider: 'github', token: pat, owner, repo, branch },
      ...(vaultPath ? { local: { path: vaultPath } } : {}),
    }
  }

  if (vaultPath) {
    return { local: { path: vaultPath } }
  }

  return {}
}

export function writeVaultConfig(config: VaultConfigFile): void {
  if (isServerless()) {
    throw new Error(
      'Configuration cannot be saved in a serverless environment. ' +
      'Set VAULT_CONFIG as a JSON environment variable in your deployment settings instead.'
    )
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function resolveVaultSettings(): ResolvedVaultSettings {
  const { remote, local } = readVaultConfig()
  const syncEnabled = !!(remote && local && !isServerless())

  if (remote?.provider === 'github') {
    return { mode: 'github', remote, local, syncEnabled }
  }
  if (remote?.provider === 'gitlab') {
    return { mode: 'gitlab', remote, local, syncEnabled }
  }
  if (local) {
    return { mode: 'local', local, syncEnabled: false }
  }
  return { mode: 'unconfigured', syncEnabled: false }
}
