import { getToken } from 'next-auth/jwt'
import { NextRequest } from 'next/server'

export type GoogleTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: 401 | 403; error: string }

export async function getGoogleAccessToken(req: NextRequest): Promise<GoogleTokenResult> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    return { ok: false, status: 401, error: 'Not authenticated' }
  }

  if (token.google_error === 'RefreshTokenError') {
    return { ok: false, status: 403, error: 'Gmail token refresh failed — please reconnect' }
  }

  if (!token.google_access_token) {
    return { ok: false, status: 403, error: 'Gmail not connected' }
  }

  return { ok: true, accessToken: token.google_access_token as string }
}
