export type DiffLine = { type: 'same' | 'add' | 'remove' | 'ellipsis'; line: string }

export function computeDiff(oldText: string, newText: string, context = 3): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length
  const n = newLines.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])

  const raw: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.unshift({ type: 'same', line: oldLines[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.unshift({ type: 'add', line: newLines[j - 1] }); j--
    } else {
      raw.unshift({ type: 'remove', line: oldLines[i - 1] }); i--
    }
  }

  const changed = new Set(raw.flatMap((d, idx) => d.type !== 'same' ? [idx] : []))
  const visible = new Set<number>()
  for (const idx of changed)
    for (let k = Math.max(0, idx - context); k <= Math.min(raw.length - 1, idx + context); k++)
      visible.add(k)

  const result: DiffLine[] = []
  let prevVisible = true
  for (let idx = 0; idx < raw.length; idx++) {
    if (visible.has(idx)) {
      result.push(raw[idx])
      prevVisible = true
    } else if (prevVisible) {
      result.push({ type: 'ellipsis', line: '' })
      prevVisible = false
    }
  }
  return result
}

export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number } {
  const diff = computeDiff(oldContent.trim(), newContent.trim())
  return {
    added: diff.filter(d => d.type === 'add').length,
    removed: diff.filter(d => d.type === 'remove').length,
  }
}
