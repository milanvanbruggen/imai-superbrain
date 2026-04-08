import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { VaultClient } from './vault-client'

export type SyncActionType = 'push' | 'pull' | 'conflict' | 'delete-local' | 'delete-remote'

export interface SyncAction {
  type: SyncActionType
  path: string
}

export interface SyncSnapshot {
  lastSync: string
  files: Record<string, string>
}

export interface SyncResult {
  ok: boolean
  pushed: number
  pulled: number
  conflicts: number
  deleted: number
  conflictFiles: string[]
  timestamp: string
}

type TreeEntry = { path: string; sha: string }

export function computeSyncActions(
  localTree: TreeEntry[],
  remoteTree: TreeEntry[],
  snapshotFiles: Record<string, string>,
): SyncAction[] {
  const localMap = new Map(localTree.map(f => [f.path, f.sha]))
  const remoteMap = new Map(remoteTree.map(f => [f.path, f.sha]))

  const allPaths = new Set([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...Object.keys(snapshotFiles),
  ])

  const actions: SyncAction[] = []

  for (const path of allPaths) {
    if (path.endsWith('.conflict.md')) continue

    const localSha = localMap.get(path) ?? null
    const remoteSha = remoteMap.get(path) ?? null
    const snapSha = snapshotFiles[path] ?? null

    const localChanged = localSha !== snapSha
    const remoteChanged = remoteSha !== snapSha

    if (localSha && remoteSha) {
      if (localSha === remoteSha) continue
      if (localChanged && !remoteChanged) {
        actions.push({ type: 'push', path })
      } else if (!localChanged && remoteChanged) {
        actions.push({ type: 'pull', path })
      } else {
        actions.push({ type: 'conflict', path })
      }
      continue
    }

    if (localSha && !remoteSha) {
      if (snapSha) {
        if (localChanged) {
          actions.push({ type: 'push', path })
        } else {
          actions.push({ type: 'delete-local', path })
        }
      } else {
        actions.push({ type: 'push', path })
      }
      continue
    }

    if (!localSha && remoteSha) {
      if (snapSha) {
        if (remoteChanged) {
          actions.push({ type: 'pull', path })
        } else {
          actions.push({ type: 'delete-remote', path })
        }
      } else {
        actions.push({ type: 'pull', path })
      }
      continue
    }

    // Neither exists (both deleted) — skip
  }

  return actions
}

export function readSnapshot(path: string): SyncSnapshot {
  if (!existsSync(path)) return { lastSync: '', files: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { lastSync: '', files: {} }
  }
}

export function writeSnapshot(path: string, snapshot: SyncSnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
}

export async function executeSync(
  localClient: VaultClient,
  remoteClient: VaultClient,
  snapshotPath: string,
): Promise<SyncResult> {
  const snapshot = readSnapshot(snapshotPath)
  const [localTree, remoteTree] = await Promise.all([
    localClient.getMarkdownTree(),
    remoteClient.getMarkdownTree(),
  ])

  // First sync: create baseline snapshot without executing any actions
  if (!snapshot.lastSync) {
    const files: Record<string, string> = {}
    for (const f of localTree) files[f.path] = f.sha
    for (const f of remoteTree) {
      if (!files[f.path]) files[f.path] = f.sha
    }
    const now = new Date().toISOString()
    writeSnapshot(snapshotPath, { lastSync: now, files })
    return { ok: true, pushed: 0, pulled: 0, conflicts: 0, deleted: 0, conflictFiles: [], timestamp: now }
  }

  const actions = computeSyncActions(localTree, remoteTree, snapshot.files)

  let pushed = 0, pulled = 0, conflicts = 0, deleted = 0
  const conflictFiles: string[] = []

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'push': {
          const { content } = await localClient.readFile(action.path)
          let remoteSha: string | null = null
          try {
            const existing = await remoteClient.readFile(action.path)
            remoteSha = existing.sha
          } catch { /* new file on remote */ }
          await remoteClient.writeFile(action.path, content, remoteSha, `sync: push ${action.path}`)
          pushed++
          break
        }
        case 'pull': {
          const { content } = await remoteClient.readFile(action.path)
          let localSha: string | null = null
          try {
            const existing = await localClient.readFile(action.path)
            localSha = existing.sha
          } catch { /* new file locally */ }
          await localClient.writeFile(action.path, content, localSha, `sync: pull ${action.path}`)
          pulled++
          break
        }
        case 'conflict': {
          const [localFile, remoteFile] = await Promise.all([
            localClient.readFile(action.path),
            remoteClient.readFile(action.path),
          ])
          // Save remote version as .conflict.md in local vault
          const conflictPath = action.path.replace(/\.md$/, '.conflict.md')
          await localClient.writeFile(conflictPath, remoteFile.content, null, `sync: conflict ${action.path}`)
          // Push local version to remote (local wins)
          await remoteClient.writeFile(action.path, localFile.content, remoteFile.sha, `sync: resolve conflict ${action.path}`)
          conflicts++
          conflictFiles.push(action.path)
          break
        }
        case 'delete-remote': {
          const { sha } = await remoteClient.readFile(action.path)
          await remoteClient.deleteFile(action.path, sha, `sync: delete ${action.path}`)
          deleted++
          break
        }
        case 'delete-local': {
          const { sha } = await localClient.readFile(action.path)
          await localClient.deleteFile(action.path, sha, `sync: delete ${action.path}`)
          deleted++
          break
        }
      }
    } catch (e) {
      // Individual file error — skip, retry next cycle
      console.warn(`[vault-sync] Failed to execute ${action.type} for ${action.path}:`, e)
    }
  }

  // Rebuild snapshot from current state
  const [newLocalTree, newRemoteTree] = await Promise.all([
    localClient.getMarkdownTree(),
    remoteClient.getMarkdownTree(),
  ])
  const newFiles: Record<string, string> = {}
  for (const f of newLocalTree) newFiles[f.path] = f.sha
  for (const f of newRemoteTree) {
    if (!newFiles[f.path]) newFiles[f.path] = f.sha
  }
  const now = new Date().toISOString()
  writeSnapshot(snapshotPath, { lastSync: now, files: newFiles })

  return { ok: true, pushed, pulled, conflicts, deleted, conflictFiles, timestamp: now }
}
