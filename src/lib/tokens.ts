import { db } from './db'

export async function consumeTokenIfExpired(userId: string): Promise<{ isActive: boolean; tokensLeft: number; expired: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, activatedAt: true, tokens: true },
  })

  if (!user) return { isActive: false, tokensLeft: 0, expired: false }

  let { isActive, activatedAt, tokens } = user

  // If currently active and 24h have passed, expire this token
  if (isActive && activatedAt) {
    const hoursSinceActivation = (Date.now() - new Date(activatedAt).getTime()) / (1000 * 60 * 60)
    if (hoursSinceActivation >= 24) {
      isActive = false
      activatedAt = null
      // Decrement the used token (only if we're expiring)
      if (tokens > 0) tokens -= 1
      await db.user.update({
        where: { id: userId },
        data: { isActive: false, activatedAt: null, tokens },
      })
    }
  }

  // If not active but has tokens, activate one
  if (!isActive && tokens > 0) {
    isActive = true
    activatedAt = new Date()
    tokens -= 1
    await db.user.update({
      where: { id: userId },
      data: { isActive: true, activatedAt, tokens },
    })
    return { isActive: true, tokensLeft: tokens, expired: false }
  }

  return { isActive, tokensLeft: tokens, expired: !isActive && tokens === 0 }
}
