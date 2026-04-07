import { NextRequest, NextResponse } from 'next/server'
import { getToken, encode } from 'next-auth/jwt'

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET
  const token = await getToken({ req, secret })

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Remove all Google fields from the token
  const { google_access_token, google_refresh_token, google_expires_at, google_error, ...rest } = token as any
  const newToken = rest

  // Sign a new JWT and set it as the session cookie
  const encoded = await encode({ token: newToken, secret: secret! })

  const isSecure = req.nextUrl.protocol === 'https:'
  const cookieName = isSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token'

  // Preserve original session expiry
  const exp = token.exp as number | undefined
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 30 * 24 * 60 * 60

  const response = NextResponse.json({ ok: true })
  response.cookies.set(cookieName, encoded, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge,
  })
  return response
}
