import { NextResponse } from 'next/server'
import { getIssuer } from '@/lib/mcp-jwt'

const PREFIX = '/.well-known/oauth-protected-resource'

// OAuth protected resource metadata (RFC 9728): tells an MCP client which server signs it in.
// /.well-known/oauth-protected-resource/api/mcp describes the resource at /api/mcp; without a
// path it describes the MCP endpoint at /api/mcp.
export async function GET(req: Request) {
  const issuer = getIssuer()
  const path = new URL(req.url).pathname.slice(PREFIX.length) || '/api/mcp'
  return NextResponse.json({
    resource: `${issuer}${path}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
  })
}
