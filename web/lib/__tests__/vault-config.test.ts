import { describe, it, expect, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

describe('resolveVaultSettings syncEnabled', () => {
  const configPath = join(process.cwd(), 'vault-config.json')
  const original = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : null

  afterEach(() => {
    if (original) {
      writeFileSync(configPath, original)
    } else if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('syncEnabled is false when not set in config', async () => {
    writeFileSync(configPath, JSON.stringify({ mode: 'local', vaultPath: '/tmp/vault' }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(false)
  })

  it('syncEnabled is true when config enables it and all required credentials are present', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_test')
    vi.stubEnv('VERCEL', undefined as any)
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      vaultPath: '/tmp/vault',
      owner: 'user',
      repo: 'vault',
      syncEnabled: true,
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(true)
  })

  it('syncEnabled is false on Vercel even when configured', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_test')
    vi.stubEnv('VERCEL', '1')
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      vaultPath: '/tmp/vault',
      owner: 'user',
      repo: 'vault',
      syncEnabled: true,
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(false)
  })

  it('syncEnabled is false when GITHUB_PAT is missing', async () => {
    vi.stubEnv('VERCEL', undefined as any)
    // Ensure no PAT in env
    writeFileSync(configPath, JSON.stringify({
      mode: 'local',
      vaultPath: '/tmp/vault',
      owner: 'user',
      repo: 'vault',
      syncEnabled: true,
    }))
    vi.resetModules()
    const { resolveVaultSettings } = await import('../vault-config')
    const settings = resolveVaultSettings()
    expect(settings.syncEnabled).toBe(false)
  })
})
