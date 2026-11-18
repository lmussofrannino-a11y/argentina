import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SESSION_COOKIE = 'miarg_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

type SessionPayload = {
  sub: string
  exp: number
  sid?: string
}

function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET
  return secret && Buffer.byteLength(secret) >= 32 ? secret : null
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSessionToken(userId: string): string {
  const secret = getSessionSecret()
  if (!secret) throw new Error('SESSION_SECRET must be configured with at least 32 bytes')

  const payload: SessionPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    sid: randomUUID(),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

function readSession(request: NextRequest): (SessionPayload & { tokenHash: string }) | null {
  const secret = getSessionSecret()
  if (!secret) return null

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null

  const [encodedPayload, suppliedSignature, ...extra] = token.split('.')
  if (!encodedPayload || !suppliedSignature || extra.length > 0) return null

  const expectedSignature = Buffer.from(sign(encodedPayload, secret))
  const actualSignature = Buffer.from(suppliedSignature)
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SessionPayload>
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }
    return { sub: payload.sub, exp: payload.exp, tokenHash: createHash('sha256').update(token).digest('hex') }
  } catch {
    return null
  }
}

export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const session = readSession(request)
  if (!session) return null
  const revoked = await db.revokedSession.findUnique({ where: { id: session.tokenHash } })
  return revoked ? null : session.sub
}

export async function revokeSession(request: NextRequest): Promise<void> {
  const session = readSession(request)
  if (!session) return
  // Hash the full token, so logout also revokes pre-upgrade cookies.
  await db.revokedSession.upsert({
    where: { id: session.tokenHash },
    create: { id: session.tokenHash, expiresAt: new Date(session.exp * 1000) },
    update: {},
  })
  await db.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const userId = await getSessionUserId(request)
  if (!userId) return false
  const user = await db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })
  return user?.isAdmin === true
}
