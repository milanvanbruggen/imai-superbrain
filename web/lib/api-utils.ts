import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

type AuthSession = NonNullable<Awaited<ReturnType<typeof getServerSession>>>
type Handler = (session: AuthSession) => Promise<Response>

export async function withAuth(handler: Handler): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return handler(session)
}
