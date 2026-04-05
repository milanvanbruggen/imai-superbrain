import type { VaultClient } from './vault-client'

export class LocalVaultClient implements VaultClient {
  constructor(private vaultPath: string) {}

  async getMarkdownTree(): Promise<{ path: string; sha: string }[]> {
    throw new Error('Not implemented yet — Task 2 will implement this')
  }

  async readFile(_path: string): Promise<{ content: string; sha: string }> {
    throw new Error('Not implemented yet — Task 2 will implement this')
  }

  async writeFile(_path: string, _content: string, _sha: string | null, _message: string): Promise<void> {
    throw new Error('Not implemented yet — Task 2 will implement this')
  }
}
