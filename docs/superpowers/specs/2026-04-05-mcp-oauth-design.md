# MCP OAuth 2.0 Design

## Goal

Secure the `/api/mcp` endpoint with a standards-compliant OAuth 2.0 Authorization Code + PKCE flow so Claude Cowork (and any MCP client) can authenticate without requiring manual Bearer token configuration.

## Context

The existing MCP endpoint (`/api/mcp`) uses a static `MCP_API_KEY` Bearer token. Claude Cowork's Connector UI only supports OAuth — it has no way to supply custom headers. The solution is to implement the MCP OAuth spec as an Authorization Server directly in the Next.js app, using stateless JWTs so it works on Vercel serverless.

## Architecture

The app acts as both Authorization Server (AS) and Resource Server (RS). All state is encoded in self-signed JWTs using the existing `NEXTAUTH_SECRET` — no database or KV store needed.

### New Routes

```
GET  /.well-known/oauth-authorization-server    Discovery metadata
POST /api/mcp/oauth/register                   Dynamic client registration
GET  /api/mcp/oauth/authorize                  Authorization Code endpoint
POST /api/mcp/oauth/token                      Token endpoint
```

### Updated Route

```
GET/POST/DELETE /api/mcp                       Verify access token JWT (replaces MCP_API_KEY check)
```

## Flow

```
1. Claude Cowork: GET /.well-known/oauth-authorization-server
   → receives authorization_endpoint, token_endpoint, registration_endpoint

2. Claude Cowork: POST /api/mcp/oauth/register { redirect_uris: [...] }
   → receives client_id (signed JWT containing redirect_uris)

3. Claude Cowork redirects user to:
   /api/mcp/oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256&state=...&response_type=code

4. Authorize endpoint:
   a. Decode client_id JWT → verify redirect_uri is allowed
   b. Check NextAuth session cookie
   c. No session → redirect to /login?callbackUrl=<authorize_url>
   d. Session present → issue auth code (5-min JWT) → redirect to redirect_uri?code=...&state=...

5. Claude Cowork: POST /api/mcp/oauth/token
   { grant_type: authorization_code, code, code_verifier, client_id, redirect_uri }
   → verify auth code JWT signature + expiry
   → verify PKCE: SHA-256(code_verifier) === code_challenge
   → issue access token (30-day JWT)

6. Claude Cowork: all MCP requests with Authorization: Bearer <access_token>
   → MCP route verifies JWT signature and expiry
   → passes authInfo to WebStandardStreamableHTTPServerTransport
```

## JWT Structures

All tokens are signed HS256 JWTs using `NEXTAUTH_SECRET`.

### Client JWT (issued as `client_id`)
```json
{
  "type": "mcp_client",
  "redirect_uris": ["https://..."],
  "iat": 1234567890
}
```
No expiry — permanent credential.

### Authorization Code JWT
```json
{
  "type": "mcp_code",
  "sub": "<nextauth-user-id>",
  "client_id": "<client-jwt>",
  "redirect_uri": "https://...",
  "code_challenge": "<base64url>",
  "code_challenge_method": "S256",
  "exp": "<now + 5 minutes>"
}
```

### Access Token JWT
```json
{
  "type": "mcp_access",
  "sub": "<nextauth-user-id>",
  "client_id": "<client-jwt>",
  "exp": "<now + 30 days>"
}
```

## Files

| File | Action | Responsibility |
|---|---|---|
| `web/lib/mcp-jwt.ts` | Create | Sign/verify JWT helpers using `jose` |
| `web/app/.well-known/oauth-authorization-server/route.ts` | Create | Return OAuth metadata JSON |
| `web/app/api/mcp/oauth/register/route.ts` | Create | Issue client_id JWT from redirect_uris |
| `web/app/api/mcp/oauth/authorize/route.ts` | Create | Session check, auth code issuance, login redirect |
| `web/app/api/mcp/oauth/token/route.ts` | Create | PKCE verify, access token issuance |
| `web/app/api/mcp/route.ts` | Modify | Replace MCP_API_KEY check with JWT verification |

## Dependencies

`jose` — already present transitively via `next-auth`. No new packages needed.

## Error Handling

- Invalid/expired client_id JWT → 400
- redirect_uri mismatch → 400
- Expired auth code → 400 `invalid_grant`
- PKCE mismatch → 400 `invalid_grant`
- Invalid/expired access token → 401 from MCP route
- Missing `NEXTAUTH_SECRET` → 500 (configuration error)

## Security Notes

- PKCE (S256) is required on all authorization requests
- Auth codes expire in 5 minutes
- Access tokens expire in 30 days
- `NEXTAUTH_SECRET` must be kept secret — it signs all tokens
- The `MCP_API_KEY` env var is no longer used for the MCP endpoint (can be removed)

## Out of Scope

- Token refresh (access tokens last 30 days; user re-authorizes when expired)
- Token revocation
- Multiple users (single-user personal app)
- Scope enforcement (all authenticated requests get full vault access)
