import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'
import GoogleProvider from 'next-auth/providers/google'
import { refreshGoogleToken } from '@/lib/google-token-refresh'

const ALLOWED_GITHUB_USER_ID = process.env.ALLOWED_GITHUB_USER_ID ?? ''
// Refresh 60 seconds before actual expiry to avoid mid-flight failures
const REFRESH_BUFFER_SECONDS = 60

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // GitHub: only allow Milan's account
      if (account?.provider === 'github') {
        return String((profile as any).id) === ALLOWED_GITHUB_USER_ID
      }
      // Google: always allow (user must already have a GitHub session to reach settings)
      return true
    },
    async jwt({ token, account }) {
      // Store Google tokens when user connects Google
      if (account?.provider === 'google') {
        return {
          ...token,
          google_access_token: account.access_token,
          google_refresh_token: account.refresh_token,
          google_expires_at: account.expires_at,
          google_error: undefined,
        }
      }

      // Proactively refresh if token expires within REFRESH_BUFFER_SECONDS
      const expiresAt = token.google_expires_at as number | undefined
      if (expiresAt && Date.now() / 1000 > expiresAt - REFRESH_BUFFER_SECONDS) {
        const refreshToken = token.google_refresh_token as string | undefined
        if (refreshToken) {
          const refreshed = await refreshGoogleToken(refreshToken)
          return { ...token, ...refreshed }
        }
      }

      return token
    },
    async session({ session, token }) {
      // ONLY expose connection status — never the token itself
      ;(session as any).googleConnected =
        !!token.google_access_token && token.google_error !== 'RefreshTokenError'
      ;(session as any).googleError = token.google_error ?? null
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
