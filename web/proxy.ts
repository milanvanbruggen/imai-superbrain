import { withAuth } from 'next-auth/middleware'

export default withAuth

export const config = {
  matcher: ['/((?!api/auth|api/mcp|api/cron|login|_next|favicon.ico|icon.svg|apple-icon.png|brand/|icon-192.png|icon-512.png|manifest.json|\\.well-known).*)'],
}
