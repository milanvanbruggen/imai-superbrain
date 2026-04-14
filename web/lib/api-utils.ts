import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

type AuthSession = NonNullable<Awaited<ReturnType<typeof getServerSession>>>
type Handler<T = unknown> = (session: AuthSession) => Promise<NextResponse<T>>

export async function withAuth<T>(handler: Handler<T>): Promise<NextResponse<T>> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' } as T, { status: 401 })
  return handler(session)
}
