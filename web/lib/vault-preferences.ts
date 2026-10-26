import type { VaultClient } from './vault-client'

// Preferences that must also work on Vercel, where vault-config.json can't be written,
// so they live inside the vault next to the AI suggestions.
export const PREFERENCES_PATH = '.superbrain/preferences.json'

export interface VaultPreferences {
  /** Path of the note that represents the vault owner, e.g. people/Milan.md */
  ownerNote?: string
}

export async function readVaultPreferences(client: VaultClient): Promise<{ prefs: VaultPreferences; sha: string | null }> {
  try {
    const { content, sha } = await client.readFile(PREFERENCES_PATH)
    const parsed = JSON.parse(content)
    return { prefs: parsed && typeof parsed === 'object' ? parsed : {}, sha }
  } catch {
    return { prefs: {}, sha: null }
  }
}

export async function writeVaultPreferences(client: VaultClient, prefs: VaultPreferences, sha: string | null): Promise<void> {
  await client.writeFile(PREFERENCES_PATH, JSON.stringify(prefs, null, 2) + '\n', sha, 'brain: update preferences')
}
