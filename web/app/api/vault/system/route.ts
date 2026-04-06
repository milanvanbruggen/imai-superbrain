import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getVaultClient } from '@/lib/vault-client'

export interface SystemFile {
  path: string
  name: string
  dir: string
}

const SYSTEM_DIRS = ['Claude', 'templates']
const ROOT_SYSTEM_FILES = ['CLAUDE.md', 'memory.md']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const client = getVaultClient()
  const files: SystemFile[] = []

  // Root system files
  for (const name of ROOT_SYSTEM_FILES) {
    try {
      await client.readFile(name)
      files.push({ path: name, name, dir: '/' })
    } catch {
      // File doesn't exist — skip
    }
  }

  // System directories — use getMarkdownTree and filter by prefix
  try {
    const tree = await client.getSystemFiles(SYSTEM_DIRS)
    for (const { path } of tree) {
      const parts = path.split('/')
      const name = parts[parts.length - 1]
      const dir = parts.slice(0, -1).join('/') || '/'
      files.push({ path, name, dir })
    }
  } catch {
    // getSystemFiles may not be available on all clients — ignore
  }

  return NextResponse.json({ files })
}
