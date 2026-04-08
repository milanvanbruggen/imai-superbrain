import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getVaultClient } from '../vault-client'
import { LocalVaultClient } from '../local'
import { GitHubVaultClient } from '../github'

const mockResolveVaultSettings = vi.fn()

vi.mock('../vault-config', () => ({
  resolveVaultSettings: () => mockResolveVaultSettings(),
}))

describe('getVaultClient', () => {
  beforeEach(() => mockResolveVaultSettings.mockReset())

  it('throws when vault is unconfigured', () => {
    mockResolveVaultSettings.mockReturnValue({ mode: 'unconfigured' })
    expect(() => getVaultClient()).toThrow()
  })

  it('returns LocalVaultClient in local mode', () => {
    mockResolveVaultSettings.mockReturnValue({ mode: 'local', vaultPath: '/tmp/vault' })
    expect(getVaultClient()).toBeInstanceOf(LocalVaultClient)
  })

  it('returns GitHubVaultClient in github mode', () => {
    mockResolveVaultSettings.mockReturnValue({
      mode: 'github', pat: 'token', owner: 'owner', repo: 'repo', branch: 'main',
    })
    expect(getVaultClient()).toBeInstanceOf(GitHubVaultClient)
  })

  it('prefers local mode when both are configured', () => {
    mockResolveVaultSettings.mockReturnValue({
      mode: 'local', vaultPath: '/tmp/vault', pat: 'token', owner: 'owner', repo: 'repo',
    })
    expect(getVaultClient()).toBeInstanceOf(LocalVaultClient)
  })
})
