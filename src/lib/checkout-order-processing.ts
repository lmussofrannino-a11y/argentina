import { db, lockUserForTokenUpdate } from '@/lib/db'

export type MercadoPagoCheckoutOrder = {
  id: string
  type?: string
  status?: string
  status_detail?: string
  external_reference?: string | null
  total_amount?: string | number
  total_paid_amount?: string | number
  currency?: string
  currency_id?: string
  transactions?: {
    payments?: Array<{ id?: string; status?: string; status_detail?: string; amount?: string | number }>
    refunds?: Array<{ amount?: string | number }>
  }
}

export async function fetchMercadoPagoOrder(orderId: string, signal?: AbortSignal): Promise<MercadoPagoCheckoutOrder | null> {
  const accessToken = process.env.MERCADO_PAGO_ORDERS_ACCESS_TOKEN
  if (!accessToken) throw new Error('MERCADO_PAGO_ORDERS_ACCESS_TOKEN is not configured')

  const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) return null

  const order = await response.json()
  if (!order || typeof order !== 'object' || typeof order.id !== 'string') return null
  return order as MercadoPagoCheckoutOrder
}

export async function applyApprovedCheckoutOrder(order: MercadoPagoCheckoutOrder) {
  if (getCheckoutOrderReversalStatus(order)) {
    const result = await applyCheckoutOrderReversal(order)
    return { ...result, success: false, message: result.message ?? 'La order tiene una reversión y no puede acreditarse' }
  }
  if (order.status !== 'processed' || order.status_detail !== 'accredited') {
    return { success: false, alreadyProcessed: false, message: 'La order no está procesada y acreditada' }
  }

  const providerOrderId = order.id
  const internalOrderId = order.external_reference
  if (!internalOrderId) {
    return { success: false, alreadyProcessed: false, message: 'La order no tiene referencia externa' }
  }

  const localOrder = await db.paymentOrder.findFirst({
    where: { id: internalOrderId, providerOrderId },
  })
  if (!localOrder) return { success: false, alreadyProcessed: false, message: 'Order local no encontrada' }

  const currency = order.currency ?? order.currency_id
  if (Number(order.total_amount) !== localOrder.amount || currency !== localOrder.currency) {
    return { success: false, alreadyProcessed: false, message: 'El importe o la moneda no coinciden con la order local' }
  }
  if (
    order.total_paid_amount !== undefined &&
    Number(order.total_paid_amount) < localOrder.amount
  ) {
    return { success: false, alreadyProcessed: false, message: 'El total pagado no cubre el importe de la order' }
  }

  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, localOrder.userId)
    const existingPayment = await transaction.processedPayment.findUnique({ where: { id: providerOrderId } })
    if (existingPayment) {
      if (existingPayment.userId !== localOrder.userId || existingPayment.orderId !== localOrder.id) {
        return { success: false, alreadyProcessed: false, message: 'El pago no pertenece a esta order' }
      }
      if (existingPayment.status !== 'approved') {
        return { success: false, alreadyProcessed: true, status: existingPayment.status, message: 'La order ya fue revertida o requiere conciliación' }
      }
      const user = await transaction.user.findUnique({
        where: { id: existingPayment.userId },
        select: { tokens: true, tokenDebt: true },
      })
      return {
        success: true,
        alreadyProcessed: true,
        tokens: user?.tokens ?? 0,
        tokenDebt: user?.tokenDebt ?? 0,
        quantity: existingPayment.quantity ?? localOrder.quantity,
      }
    }

    const claimedOrder = await transaction.paymentOrder.updateMany({
      where: { id: localOrder.id, providerOrderId, status: 'pending' },
      data: { status: 'paid' },
    })
    if (claimedOrder.count !== 1) {
      const processedAfterRace = await transaction.processedPayment.findUnique({ where: { id: providerOrderId } })
      if (processedAfterRace?.status === 'approved' && processedAfterRace.userId === localOrder.userId && processedAfterRace.orderId === localOrder.id) {
        const user = await transaction.user.findUnique({
          where: { id: processedAfterRace.userId },
          select: { tokens: true, tokenDebt: true },
        })
        return {
          success: true,
          alreadyProcessed: true,
          tokens: user?.tokens ?? 0,
          tokenDebt: user?.tokenDebt ?? 0,
          quantity: processedAfterRace.quantity ?? localOrder.quantity,
        }
      }
      return { success: false, alreadyProcessed: false, message: 'La order local ya fue procesada o no está pendiente' }
    }

    await transaction.processedPayment.create({
      data: {
        id: providerOrderId,
        userId: localOrder.userId,
        orderId: localOrder.id,
        quantity: localOrder.quantity,
        amount: localOrder.amount,
        currency: localOrder.currency,
        status: 'approved',
        creditedQuantity: localOrder.quantity,
      },
    })

    const currentUser = await transaction.user.findUnique({
      where: { id: localOrder.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!currentUser) throw new Error('Payment order owner no longer exists')

    const debtPaid = Math.min(currentUser.tokenDebt, localOrder.quantity)
    const tokensAdded = localOrder.quantity - debtPaid
    const user = await transaction.user.update({
      where: { id: localOrder.userId },
      data: {
        tokens: { increment: tokensAdded },
        tokenDebt: { decrement: debtPaid },
      },
      select: { tokens: true, tokenDebt: true },
    })

    return {
      success: true,
      alreadyProcessed: false,
      tokens: user.tokens,
      tokenDebt: user.tokenDebt,
      tokensAdded,
      quantity: localOrder.quantity,
    }
  })
}

export function getCheckoutOrderReversalStatus(order: MercadoPagoCheckoutOrder) {
  if (order.status === 'refunded' || order.status === 'charged_back') return order.status
  if (order.status_detail === 'partially_refunded' || order.transactions?.refunds?.some((refund) => Number(refund.amount) > 0)) return 'partial_refund_review'
  return null
}

export async function applyCheckoutOrderReversal(order: MercadoPagoCheckoutOrder) {
  const reversalStatus = getCheckoutOrderReversalStatus(order)
  const isPartialRefund = reversalStatus === 'partial_refund_review'
  if (!reversalStatus) {
    return { success: false, alreadyProcessed: false, message: 'La order no tiene un estado de reversión' }
  }

  const providerOrderId = order.id
  const internalOrderId = order.external_reference
  if (!internalOrderId) {
    return { success: false, alreadyProcessed: false, message: 'La order no tiene referencia externa' }
  }

  const localOrder = await db.paymentOrder.findFirst({
    where: { id: internalOrderId, providerOrderId },
  })
  if (!localOrder) return { success: false, alreadyProcessed: false, message: 'Order local no encontrada para revertir' }

  const currency = order.currency ?? order.currency_id
  if (Number(order.total_amount) !== localOrder.amount || currency !== localOrder.currency) {
    return { success: false, alreadyProcessed: false, message: 'El importe o la moneda no coinciden con la order local' }
  }

  if (isPartialRefund) {
    return db.$transaction(async (transaction) => {
      await lockUserForTokenUpdate(transaction, localOrder.userId)
      const claimed = await transaction.paymentOrder.updateMany({
        where: { id: localOrder.id, providerOrderId, status: { in: ['pending', 'paid'] } },
        data: { status: 'partial_refund_review' },
      })
      if (claimed.count !== 1) {
        const latest = await transaction.paymentOrder.findUniqueOrThrow({ where: { id: localOrder.id } })
        const final = latest.status === 'refunded' || latest.status === 'charged_back'
        return { success: final, alreadyProcessed: true, status: latest.status, message: final ? undefined : 'El reembolso parcial requiere conciliación manual' }
      }
      const processed = await transaction.processedPayment.findUnique({ where: { id: providerOrderId } })
      if (!processed) {
        await transaction.processedPayment.create({
          data: { id: providerOrderId, userId: localOrder.userId, orderId: localOrder.id, quantity: localOrder.quantity, amount: localOrder.amount, currency: localOrder.currency, status: 'partial_refund_review', creditedQuantity: 0 },
        })
      }
      await transaction.processedPayment.updateMany({
        where: { id: providerOrderId, status: 'approved' },
        data: { status: 'partial_refund_review' },
      })
      return { success: false, alreadyProcessed: false, status: 'partial_refund_review', message: 'El reembolso parcial requiere conciliación manual' }
    })
  }

  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, localOrder.userId)
    const processed = await transaction.processedPayment.findUnique({ where: { id: providerOrderId } })
    const claimedOrder = await transaction.paymentOrder.updateMany({
      where: {
        id: localOrder.id,
        providerOrderId,
        status: { in: ['pending', 'paid', 'partial_refund_review'] },
      },
      data: { status: reversalStatus },
    })
    if (claimedOrder.count !== 1) {
      const latestOrder = await transaction.paymentOrder.findUnique({ where: { id: localOrder.id } })
      const user = await transaction.user.findUnique({
        where: { id: localOrder.userId },
        select: { tokens: true, tokenDebt: true },
      })
      if (latestOrder?.status === 'refunded' || latestOrder?.status === 'charged_back') {
        return {
          success: true,
          alreadyProcessed: true,
          status: latestOrder.status,
          tokens: user?.tokens ?? 0,
          tokenDebt: user?.tokenDebt ?? 0,
        }
      }
      return { success: false, alreadyProcessed: false, message: 'La order ya fue conciliada' }
    }

    const payment = processed ?? await transaction.processedPayment.findUnique({ where: { id: providerOrderId } })
    if (!payment) {
      await transaction.processedPayment.create({
        data: { id: providerOrderId, userId: localOrder.userId, orderId: localOrder.id, quantity: localOrder.quantity, amount: localOrder.amount, currency: localOrder.currency, status: reversalStatus, creditedQuantity: 0 },
      })
      const current = await transaction.user.findUniqueOrThrow({ where: { id: localOrder.userId }, select: { tokens: true, tokenDebt: true } })
      return { success: true, alreadyProcessed: false, status: reversalStatus, ...current }
    }

    const user = await transaction.user.findUnique({
      where: { id: localOrder.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!user) throw new Error('Payment order owner no longer exists')

    const creditedQuantity = payment.creditedQuantity ?? payment.quantity ?? localOrder.quantity
    const tokensRemoved = Math.min(user.tokens, creditedQuantity)
    const remainingDebt = creditedQuantity - tokensRemoved
    await transaction.user.update({
      where: { id: localOrder.userId },
      data: {
        tokens: { decrement: tokensRemoved },
        tokenDebt: { increment: remainingDebt },
        ...(creditedQuantity > 0 ? { isActive: false, activatedAt: null } : {}),
      },
    })
    await transaction.processedPayment.update({
      where: { id: providerOrderId },
      data: { status: reversalStatus },
    })

    return {
      success: true,
      alreadyProcessed: false,
      status: reversalStatus,
      tokens: user.tokens - tokensRemoved,
      tokenDebt: user.tokenDebt + remainingDebt,
    }
  })
}
