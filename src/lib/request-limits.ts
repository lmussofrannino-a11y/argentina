import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export class RequestLimitError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function readLimitedJson(request: NextRequest, limit = 16384): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > limit) throw new RequestLimitError(413, 'La solicitud es demasiado grande')
  if (!request.body) throw new RequestLimitError(400, 'Solicitud no válida')
  const reader = request.body.getReader()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => {})
  }, 10000)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (timedOut) throw new RequestLimitError(408, 'Se agotó el tiempo para recibir la solicitud')
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new RequestLimitError(413, 'La solicitud es demasiado grande')
      }
      chunks.push(value)
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body')
    return parsed
  } catch (error) {
    if (error instanceof RequestLimitError) throw error
    throw new RequestLimitError(400, 'Solicitud no válida')
  } finally { clearTimeout(deadline); reader.releaseLock() }
}

// Vercel overwrites x-forwarded-for at its ingress. Outside that trusted
// deployment all clients share a conservative bucket instead of trusting spoofed IPs.
export function requestActor(request: NextRequest): string {
  return process.env.VERCEL === '1' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local'
}

export async function enforceRateLimit(scope: string, actor: string, limit: number, windowMs: number) {
  const id = createHash('sha256').update(`${scope}:${actor}`).digest('hex')
  // One atomic statement; works across serverless instances and cold starts.
  const [bucket] = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("id", "count", "resetAt")
    VALUES (${id}, 1, ${new Date(Date.now() + windowMs)})
    ON CONFLICT ("id") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count"
  `
  if (!bucket || bucket.count > limit) throw new RequestLimitError(429, 'Demasiados intentos. Esperá unos minutos e intentá nuevamente.')
}
