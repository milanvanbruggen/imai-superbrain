export async function refreshGoogleToken(refreshToken: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    return { google_error: 'RefreshTokenError' }
  }

  const data = await res.json()
  return {
    google_access_token: data.access_token,
    google_expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    google_error: undefined,
  }
}
