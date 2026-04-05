import { withAuth } from 'next-auth/middleware'

export default withAuth

export const config = {
  matcher: ['/((?!api/auth|api/mcp|login|_next|favicon.ico|icon-192.png|icon-512.png|manifest.json|\\.well-known).*)'],
}
