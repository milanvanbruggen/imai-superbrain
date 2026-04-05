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

### Updated Routes

```
GET/POST/DELETE /api/mcp                       Verify access token JWT (replaces MCP_API_KEY check)
GET /login                                     Forward callbackUrl query param to signIn (fix)
```

## Flow

```
1. Claude Cowork: GET /.well-known/oauth-authorization-server
   → receives authorization_endpoint, token_endpoint, registration_endpoint

2. Claude Cowork: POST /api/mcp/oauth/register { redirect_uris: [...] }
   → receives { client_id (signed JWT), redirect_uris, token_endpoint_auth_method: "none" }

3. Claude Cowork redirects user to:
   /api/mcp/oauth/authorize
     ?client_id=...&redirect_uri=...
     &code_challenge=...&code_challenge_method=S256
     &state=...&response_type=code

   Reject immediately with 400 invalid_request if:
   - code_challenge is absent
   - code_challenge_method is not "S256"

4. Authorize endpoint:
   a. Decode client_id JWT → verify signature + type="mcp_client"
   b. Verify redirect_uri is in client JWT's redirect_uris list
   c. Check NextAuth session cookie
   d. No session → redirect to /login?callbackUrl=<full authorize URL>
      (login page must read callbackUrl from query string and forward to signIn)
   e. Session present → issue auth code JWT → redirect to redirect_uri?code=...&state=...
      (state is forwarded verbatim only if present in original request)

5. Claude Cowork: POST /api/mcp/oauth/token
   { grant_type: authorization_code, code, code_verifier, client_id, redirect_uri }

   Validation steps (reject 400 invalid_grant on any failure):
   a. Verify auth code JWT signature + expiry
   b. Verify auth code JWT type = "mcp_code"
   c. Verify client_id in request matches client_id in auth code JWT
   d. Verify redirect_uri in request matches exactly redirect_uri stored in auth code JWT (RFC 6749 §4.1.3)
   e. Verify PKCE: BASE64URL(SHA-256(code_verifier)) === code_challenge from auth code JWT
   → Issue access token JWT (30-day)

6. Claude Cowork: all MCP requests with Authorization: Bearer <access_token>
   → MCP route verifies JWT signature, expiry, and type="mcp_access"
   → passes authInfo to WebStandardStreamableHTTPServerTransport
```

## OAuth Metadata Response

`GET /.well-known/oauth-authorization-server` returns:

```json
{
  "issuer": "https://mai-superbrain-web.vercel.app",
  "authorization_endpoint": "https://mai-superbrain-web.vercel.app/api/mcp/oauth/authorize",
  "token_endpoint": "https://mai-superbrain-web.vercel.app/api/mcp/oauth/token",
  "registration_endpoint": "https://mai-superbrain-web.vercel.app/api/mcp/oauth/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

The `issuer` is resolved at runtime as: `process.env.NEXTAUTH_URL ?? "https://mai-superbrain-web.vercel.app"`. This value is used for both the metadata response and all `iss` claims in issued JWTs. `NEXTAUTH_URL` must be set correctly in all environments to ensure `iss` validation is consistent.

## JWT Structures

All tokens are signed HS256 JWTs using `NEXTAUTH_SECRET`. All client JWTs include `iss: <issuer>` and are validated against it to prevent cross-environment token reuse.

### Client JWT (issued as `client_id`)
```json
{
  "type": "mcp_client",
  "iss": "https://mai-superbrain-web.vercel.app",
  "redirect_uris": ["https://..."],
  "iat": 1234567890
}
```
No expiry — permanent credential.

### Authorization Code JWT
```json
{
  "type": "mcp_code",
  "iss": "https://mai-superbrain-web.vercel.app",
  "sub": "<nextauth-user-id>",
  "client_id": "<client-jwt-string>",
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
  "iss": "https://mai-superbrain-web.vercel.app",
  "sub": "<nextauth-user-id>",
  "client_id": "<client-jwt-string>",
  "exp": "<now + 30 days>"
}
```

## Dynamic Client Registration Response

`POST /api/mcp/oauth/register` returns (RFC 7591 conformant):

```json
{
  "client_id": "<signed JWT>",
  "redirect_uris": ["https://..."],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"],
  "response_types": ["code"]
}
```

No `client_secret` — this is a public client.

## Files

| File | Action | Responsibility |
|---|---|---|
| `web/lib/mcp-jwt.ts` | Create | sign/verify helpers using `jose` |
| `web/app/.well-known/oauth-authorization-server/route.ts` | Create | OAuth metadata JSON |
| `web/app/api/mcp/oauth/register/route.ts` | Create | Issue client_id JWT |
| `web/app/api/mcp/oauth/authorize/route.ts` | Create | Session check, PKCE validation, auth code issuance, login redirect |
| `web/app/api/mcp/oauth/token/route.ts` | Create | PKCE verify, redirect_uri exact-match, access token issuance |
| `web/app/api/mcp/route.ts` | Modify | Replace MCP_API_KEY check with JWT verification; map `sub` → `authInfo.token`, `client_id` → `authInfo.clientId` |
| `web/app/login/page.tsx` | Modify | Read `callbackUrl` query param and forward to `signIn` |

## Dependencies

`jose` must be added as a **direct** dependency (pinned to `^5.0.0`). Although a `jose` copy is currently present in `node_modules` transitively, the version is not guaranteed stable across lockfile regenerations.

## Error Handling

| Condition | Response |
|---|---|
| Missing `code_challenge` or wrong method | 400 `invalid_request` at authorize |
| Invalid/expired client_id JWT | 400 `invalid_client` at authorize and token |
| redirect_uri not in client's allowed list | 400 `invalid_request` at authorize |
| Expired auth code | 400 `invalid_grant` at token |
| PKCE mismatch | 400 `invalid_grant` at token |
| redirect_uri mismatch at token step | 400 `invalid_grant` at token |
| Invalid/expired access token | 401 at MCP route |
| Missing `NEXTAUTH_SECRET` | 500 |

## Security Notes

- PKCE (S256) is **required** — requests without `code_challenge` are rejected at the authorize endpoint
- Auth codes expire in 5 minutes
- Access tokens expire in 30 days with **no revocation path** — a stolen token is valid for the full window; acceptable for a single-user personal app
- All JWTs include an `iss` claim validated on decode to prevent cross-environment reuse (e.g., staging tokens rejected in production)
- A leaked `client_id` JWT is a **permanent credential** — it does not expire and has no revocation path other than rotating `NEXTAUTH_SECRET`. Treat client_id values as secrets.
- **`NEXTAUTH_SECRET` rotation is a breaking change** — it immediately invalidates all outstanding access tokens, auth codes, and client_id JWTs. All connected MCP clients must re-authorize. Treat secret rotation as a planned maintenance event.
- The `MCP_API_KEY` env var is no longer used and can be removed from Vercel after migration

## Out of Scope

- Token refresh (access tokens last 30 days; user re-authorizes when expired)
- Token revocation endpoint
- Multiple users
- Scope enforcement (all authenticated requests get full vault access)
