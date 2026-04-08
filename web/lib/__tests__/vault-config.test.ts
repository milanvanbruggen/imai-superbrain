import { describe, it, expect, afterEach, vi } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

describe('resolveVaultSettings syncEnabled', () => {
  const configPath = join(process.cwd(), 'vault-config.json')
  const original = existsSync(configPath) ? require('fs').readFileSync(configPath, 'utf-8') : null

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

  it('syncEnabled is true when config has it and both vaults configured', async () => {
    vi.stubEnv('GITHUB_PAT', 'ghp_test')
    vi.stubEnv('VERCEL', '')
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
})
