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
