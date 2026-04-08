import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getVaultClient } from '../vault-client'
import { LocalVaultClient } from '../local'
import { GitHubVaultClient } from '../github'
import { GitLabVaultClient } from '../gitlab'

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
    mockResolveVaultSettings.mockReturnValue({
      mode: 'local',
      local: { path: '/tmp/vault' },
    })
    expect(getVaultClient()).toBeInstanceOf(LocalVaultClient)
  })

  it('returns GitHubVaultClient in github mode', () => {
    mockResolveVaultSettings.mockReturnValue({
      mode: 'github',
      remote: { provider: 'github', token: 'tok', owner: 'owner', repo: 'repo', branch: 'main' },
    })
    expect(getVaultClient()).toBeInstanceOf(GitHubVaultClient)
  })

  it('returns GitLabVaultClient in gitlab mode', () => {
    mockResolveVaultSettings.mockReturnValue({
      mode: 'gitlab',
      remote: { provider: 'gitlab', token: 'tok', namespace: 'ns', project: 'proj' },
    })
    expect(getVaultClient()).toBeInstanceOf(GitLabVaultClient)
  })
})
