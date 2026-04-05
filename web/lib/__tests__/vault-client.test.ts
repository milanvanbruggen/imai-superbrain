import { describe, it, expect, vi, afterEach } from 'vitest'

describe('getVaultClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules() // required: prevents module cache from leaking stubbed env vars between tests
  })

  it('throws when neither VAULT_PATH nor GitHub vars are set', async () => {
    vi.stubEnv('VAULT_PATH', '')
    vi.stubEnv('GITHUB_PAT', '')
    vi.stubEnv('GITHUB_VAULT_OWNER', '')
    vi.stubEnv('GITHUB_VAULT_REPO', '')
    const { getVaultClient } = await import('../vault-client')
    expect(() => getVaultClient()).toThrow()
  })

  it('returns LocalVaultClient when VAULT_PATH is set', async () => {
    vi.stubEnv('VAULT_PATH', '/tmp/vault')
    vi.stubEnv('GITHUB_PAT', '')
    const { getVaultClient } = await import('../vault-client')
    const { LocalVaultClient } = await import('../local')
    const client = getVaultClient()
    expect(client).toBeInstanceOf(LocalVaultClient)
  })

  it('returns GitHubVaultClient when only GitHub vars are set', async () => {
    vi.stubEnv('VAULT_PATH', '')
    vi.stubEnv('GITHUB_PAT', 'token')
    vi.stubEnv('GITHUB_VAULT_OWNER', 'owner')
    vi.stubEnv('GITHUB_VAULT_REPO', 'repo')
    const { getVaultClient } = await import('../vault-client')
    const { GitHubVaultClient } = await import('../github')
    const client = getVaultClient()
    expect(client).toBeInstanceOf(GitHubVaultClient)
  })

  it('VAULT_PATH takes priority over GitHub vars when both are set', async () => {
    vi.stubEnv('VAULT_PATH', '/tmp/vault')
    vi.stubEnv('GITHUB_PAT', 'token')
    vi.stubEnv('GITHUB_VAULT_OWNER', 'owner')
    vi.stubEnv('GITHUB_VAULT_REPO', 'repo')
    const { getVaultClient } = await import('../vault-client')
    const { LocalVaultClient } = await import('../local')
    const client = getVaultClient()
    expect(client).toBeInstanceOf(LocalVaultClient)
  })
})
