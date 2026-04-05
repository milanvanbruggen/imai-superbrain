import { SignJWT, jwtVerify } from 'jose'
import { createHash } from 'crypto'

export function getIssuer(): string {
  return process.env.NEXTAUTH_URL || 'https://mai-superbrain-web.vercel.app'
}

async function getSecret(): Promise<CryptoKey> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set')
  const keyBytes = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function signToken(
  payload: Record<string, unknown>,
  expiresIn?: string
): Promise<string> {
  const secret = await getSecret()
  const issuer = getIssuer()
  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(issuer)
  if (expiresIn) builder = builder.setExpirationTime(expiresIn)
  return builder.sign(secret)
}

export async function verifyToken(
  token: string,
  expectedType: string
): Promise<Record<string, unknown>> {
  const secret = await getSecret()
  const issuer = getIssuer()
  const { payload } = await jwtVerify(token, secret, { issuer })
  if (payload['type'] !== expectedType) {
    throw new Error(`Expected token type "${expectedType}", got "${payload['type']}"`)
  }
  return payload as Record<string, unknown>
}

export async function verifyPKCE(verifier: string, challenge: string): Promise<boolean> {
  const computed = createHash('sha256').update(verifier).digest('base64url')
  return computed === challenge
}
