import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import GitHubProvider from 'next-auth/providers/github'

const ALLOWED_GITHUB_USER_ID = process.env.ALLOWED_GITHUB_USER_ID ?? ''

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Only allow Milan's GitHub account
      return String((profile as any).id) === ALLOWED_GITHUB_USER_ID
    },
  },
  pages: {
    signIn: '/login',
  },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
