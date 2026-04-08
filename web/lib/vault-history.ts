export interface CommitEntry {
  sha: string
  shortSha: string
  message: string
  date: string | null
}

interface GitHubCreds {
  pat: string
  owner: string
  repo: string
  branch?: string
}

const ghHeaders = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

export async function listCommits(creds: GitHubCreds, limit = 50, page = 1): Promise<CommitEntry[]> {
  const base = `https://api.github.com/repos/${creds.owner}/${creds.repo}`
  const res = await fetch(`${base}/commits?sha=${creds.branch ?? 'main'}&per_page=${limit}&page=${page}`, {
    headers: ghHeaders(creds.pat),
  })
  if (!res.ok) throw new Error(`GitHub commits failed: ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected GitHub response shape')
  return data.map((item: any) => ({
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    message: item.commit.message.split('\n')[0],
    date: item.commit.author?.date ?? null,
  }))
}

export async function restoreToCommit(creds: GitHubCreds, sha: string): Promise<void> {
  if (!sha || sha.length < 40) throw new Error('Invalid SHA')
  const base = `https://api.github.com/repos/${creds.owner}/${creds.repo}`
  const headers = ghHeaders(creds.pat)
  const shortSha = sha.slice(0, 7)

  // 1. Get the tree SHA of the target commit
  const commitRes = await fetch(`${base}/git/commits/${sha}`, { headers })
  if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`)
  const commitData = await commitRes.json()
  const treeSha = commitData.tree.sha

  // 2. Get current HEAD SHA
  const refRes = await fetch(`${base}/git/refs/heads/${creds.branch ?? 'main'}`, { headers })
  if (!refRes.ok) throw new Error(`Failed to get ref: ${refRes.status}`)
  const refData = await refRes.json()
  const headSha = refData.object.sha

  // 3. Create new commit with old tree + current HEAD as parent
  const newCommitRes = await fetch(`${base}/git/commits`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `restore: revert to ${shortSha}`,
      tree: treeSha,
      parents: [headSha],
    }),
  })
  if (!newCommitRes.ok) throw new Error(`Failed to create commit: ${newCommitRes.status}`)
  const newCommit = await newCommitRes.json()

  // 4. Update branch ref to new commit
  const updateRes = await fetch(`${base}/git/refs/heads/${creds.branch ?? 'main'}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha }),
  })
  if (!updateRes.ok) throw new Error(`Failed to update ref: ${updateRes.status}`)
}
