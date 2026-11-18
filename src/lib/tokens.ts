import { db, lockUserForTokenUpdate } from './db'

const TOKEN_DURATION_MS = 24 * 60 * 60 * 1000

export async function consumeTokenIfExpired(userId: string) {
  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, userId)
    const select = { isActive: true, activatedAt: true, tokens: true, tokenDebt: true } as const
    const user = await transaction.user.findUnique({ where: { id: userId }, select })
    if (!user) return { isActive: false, tokensLeft: 0, expired: false, activated: false, tokenDebt: 0, activatedAt: null, blockedReason: null }

    if (user.tokenDebt > 0) {
      await transaction.user.updateMany({
        where: { id: userId, isActive: true, tokenDebt: { gt: 0 } },
        data: { isActive: false, activatedAt: null },
      })
      return { isActive: false, tokensLeft: user.tokens, expired: true, activated: false, tokenDebt: user.tokenDebt, activatedAt: null, blockedReason: 'debt' }
    }

    const expired = Boolean(user.isActive && user.activatedAt && Date.now() - user.activatedAt.getTime() >= TOKEN_DURATION_MS)
    if (expired) {
      await transaction.user.updateMany({
        where: { id: userId, isActive: true, activatedAt: user.activatedAt },
        data: { isActive: false, activatedAt: null },
      })
    }

    const activation = await transaction.user.updateMany({
      where: { id: userId, isActive: false, tokenDebt: 0, tokens: { gt: 0 } },
      data: { isActive: true, activatedAt: new Date(), tokens: { decrement: 1 } },
    })
    const current = await transaction.user.findUniqueOrThrow({ where: { id: userId }, select })
    return {
      isActive: current.isActive,
      tokensLeft: current.tokens,
      expired,
      activated: activation.count === 1,
      tokenDebt: current.tokenDebt,
      activatedAt: current.activatedAt,
      blockedReason: current.tokenDebt > 0 ? 'debt' : !current.isActive ? 'no_tokens' : null,
    }
  })
}
