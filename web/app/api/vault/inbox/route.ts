import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { getCachedGraph } from '@/lib/graph-cache'
import { countInboxNodes } from '@/lib/inbox-utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const graph = getCachedGraph()
  if (!graph) return NextResponse.json({ count: 0 })

  return NextResponse.json({ count: countInboxNodes(graph.nodes) })
}
