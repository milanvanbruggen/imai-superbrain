import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

const configPath = join(process.cwd(), 'vault-config.json')

function backupAndReset() {
  const original = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null
  return () => {
    if (original) writeFileSync(configPath, original)
    else if (existsSync(configPath)) unlinkSync(configPath)
    vi.unstubAllEnvs()
    vi.resetModules()
  }
}

describe('resolveVaultSettings — new format', () => {
  let restore: () => void
  beforeEach(() => { restore = backupAndReset() })
  afterEach(() => restore())

  it('returns github mode from new-format vault-config.json', async () => {
    writeFileSync(configPath, JSON.stringify({
      remote: { provider: 'github', token: 'ghp_test', owner: 'user', repo: 'vault', branch: 'main' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('github')
    expect(s.remote?.provider).toBe('github')
  })

  it('returns gitlab mode from new-format vault-config.json', async () => {
    writeFileSync(configPath, JSON.stringify({
      remote: { provider: 'gitlab', token: 'glpat_test', namespace: 'user', project: 'vault', url: 'https://gitlab.example.com' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('gitlab')
    expect(s.remote?.provider).toBe('gitlab')
  })

  it('returns local mode when only local is configured', async () => {
    writeFileSync(configPath, JSON.stringify({ local: { path: '/tmp/vault' } }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('local')
    expect(s.local?.path).toBe('/tmp/vault')
  })

  it('syncEnabled is true when both remote and local are present (non-Vercel)', async () => {
    vi.stubEnv('VERCEL', undefined as any)
    writeFileSync(configPath, JSON.stringify({
      remote: { provider: 'github', token: 'ghp_test', owner: 'user', repo: 'vault' },
      local: { path: '/tmp/vault' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    expect(resolveVaultSettings().syncEnabled).toBe(true)
  })

  it('syncEnabled is false on Vercel even when both configured', async () => {
    vi.stubEnv('VERCEL', '1')
    writeFileSync(configPath, JSON.stringify({
      remote: { provider: 'github', token: 'ghp_test', owner: 'user', repo: 'vault' },
      local: { path: '/tmp/vault' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    expect(resolveVaultSettings().syncEnabled).toBe(false)
  })
})

describe('resolveVaultSettings — VAULT_CONFIG env var', () => {
  let restore: () => void
  beforeEach(() => { restore = backupAndReset() })
  afterEach(() => restore())

  it('reads from VAULT_CONFIG env var when no file exists', async () => {
    if (existsSync(configPath)) unlinkSync(configPath)
    vi.stubEnv('VAULT_CONFIG', JSON.stringify({
      remote: { provider: 'gitlab', token: 'glpat_x', namespace: 'ns', project: 'proj' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('gitlab')
  })

  it('vault-config.json takes priority over VAULT_CONFIG env var', async () => {
    writeFileSync(configPath, JSON.stringify({
      remote: { provider: 'github', token: 'ghp_file', owner: 'file-user', repo: 'vault' },
    }))
    vi.stubEnv('VAULT_CONFIG', JSON.stringify({
      remote: { provider: 'gitlab', token: 'glpat_env', namespace: 'env-user', project: 'vault' },
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    expect(resolveVaultSettings().mode).toBe('github')
  })
})

describe('resolveVaultSettings — legacy env vars', () => {
  let restore: () => void
  beforeEach(() => { restore = backupAndReset() })
  afterEach(() => restore())

  it('reads legacy GITHUB_* env vars when no file or VAULT_CONFIG exists', async () => {
    if (existsSync(configPath)) unlinkSync(configPath)
    vi.stubEnv('GITHUB_PAT', 'ghp_legacy')
    vi.stubEnv('GITHUB_VAULT_OWNER', 'legacy-owner')
    vi.stubEnv('GITHUB_VAULT_REPO', 'legacy-repo')
    vi.stubEnv('GITHUB_VAULT_BRANCH', 'main')
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('github')
    if (s.remote?.provider !== 'github') throw new Error('expected github')
    expect(s.remote.owner).toBe('legacy-owner')
  })
})

describe('resolveVaultSettings — legacy vault-config.json format', () => {
  let restore: () => void
  beforeEach(() => { restore = backupAndReset() })
  afterEach(() => restore())

  it('reads old-format vault-config.json (mode/owner/repo)', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_old')
    writeFileSync(configPath, JSON.stringify({
      mode: 'github',
      owner: 'old-owner',
      repo: 'old-repo',
      branch: 'main',
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.mode).toBe('github')
    if (s.remote?.provider !== 'github') throw new Error('expected github')
    expect(s.remote.owner).toBe('old-owner')
  })

  it('reads old-format with vaultPath', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_old')
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      owner: 'old-owner',
      repo: 'old-repo',
      vaultPath: '/tmp/old-vault',
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const s = resolveVaultSettings()
    expect(s.local?.path).toBe('/tmp/old-vault')
  })
})
