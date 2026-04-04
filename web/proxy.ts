import { withAuth } from 'next-auth/middleware'
import type { NextRequest } from 'next/server'

export default withAuth

export const config = {
  matcher: ['/((?!api/auth|login|_next|favicon.ico).*)'],
}
