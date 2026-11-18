import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db, lockUserForTokenUpdate } from '@/lib/db'
import { PAYMENT_PACKS } from '@/lib/payment-catalog'

export type MercadoPagoPayment = {
  id: string | number
  status?: string
  external_reference?: string | null
  preference_id?: string | number | null
  transaction_amount?: number
  transaction_amount_refunded?: number
  currency_id?: string
  metadata?: Record<string, unknown> | null
  order?: { id?: string | number; type?: string } | null
}

export type PaymentProcessingResult = {
  success: boolean
  alreadyProcessed: boolean
  tokensAdded?: number
  tokenDebt?: number
  message?: string
  tokens?: number
  quantity?: number
  status?: string
}

function getLegacyPackForPayment(payment: MercadoPagoPayment) {
  if (payment.currency_id !== 'ARS') return null
  return Object.values(PAYMENT_PACKS).find((pack) => pack.amount === Number(payment.transaction_amount)) ?? null
}

// Definitive reversals always win over a residual partial-refund amount.
export function getPaymentReversalStatus(payment: MercadoPagoPayment) {
  if (payment.status === 'refunded' || payment.status === 'charged_back') return payment.status
  if (Number(payment.transaction_amount_refunded ?? 0) > 0) return 'partial_refund_review'
  return null
}

async function resolvePaymentPreferenceId(payment: MercadoPagoPayment): Promise<string | null> {
  if (payment.preference_id != null) return String(payment.preference_id)
  if (payment.order?.id == null) return null
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not configured')
  const response = await fetch(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(String(payment.order.id))}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Could not resolve Mercado Pago merchant order')
  const merchantOrder = await response.json()
  if (
    String(merchantOrder.id) !== String(payment.order.id) ||
    merchantOrder.external_reference !== payment.external_reference ||
    typeof merchantOrder.preference_id !== 'string' ||
    !Array.isArray(merchantOrder.payments) ||
    !merchantOrder.payments.some((entry: { id?: unknown }) => entry?.id != null && String(entry.id) === String(payment.id))
  ) return null
  return merchantOrder.preference_id
}

export async function fetchMercadoPagoPayment(paymentId: string | number, signal?: AbortSignal): Promise<MercadoPagoPayment | null> {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not configured')

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  })
  if (!response.ok) return null

  const payment = await response.json()
  if (!payment || typeof payment !== 'object' || !('id' in payment)) return null
  return payment as MercadoPagoPayment
}

export function isValidMercadoPagoWebhook(
  request: NextRequest,
  dataId: string,
  secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET,
): boolean {
  const requestId = request.headers.get('x-request-id')
  const signatureHeader = request.headers.get('x-signature')
  if (!secret || !requestId || !signatureHeader) return false

  const values: Record<string, string> = {}
  for (const part of signatureHeader.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 1) return false
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!value || Object.hasOwn(values, key)) return false
    values[key] = value
  }
  if (!/^\d{10}(\d{3})?$/.test(values.ts ?? '') || !/^[a-f0-9]{64}$/.test(values.v1 ?? '')) return false
  const timestampMs = Number(values.ts) * (values.ts.length === 10 ? 1000 : 1)
  // Explicit bounded replay policy: allow delayed delivery/retries for seven
  // days, and at most five minutes of future clock skew. Credits remain idempotent.
  if (timestampMs < Date.now() - 7 * 24 * 60 * 60 * 1000 || timestampMs > Date.now() + 5 * 60 * 1000) return false

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${values.ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(values.v1, 'hex')
  } catch {
    return false
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export async function applyApprovedPayment(payment: MercadoPagoPayment): Promise<{
  success: boolean
  alreadyProcessed: boolean
  tokensAdded?: number
  tokenDebt?: number
  message?: string
  tokens?: number
  quantity?: number
  status?: string
}> {
  if (getPaymentReversalStatus(payment)) {
    const result = await applyPaymentReversal(payment)
    return { ...result, success: false, message: result.message ?? 'El pago tiene una reversión y no puede acreditarse' }
  }
  if (payment.status !== 'approved') {
    return { success: false, alreadyProcessed: false, message: 'El pago no está aprobado' }
  }

  const orderId = payment.external_reference
  if (!orderId) {
    return { success: false, alreadyProcessed: false, message: 'El pago no está asociado a una orden válida' }
  }

  const order = await db.paymentOrder.findUnique({ where: { id: orderId } })
  if (!order) return { success: false, alreadyProcessed: false, message: 'Orden de pago no encontrada' }
  const preferenceId = await resolvePaymentPreferenceId(payment)
  if (!preferenceId || !order.preferenceId || order.providerOrderId || order.preferenceId !== preferenceId) {
    return { success: false, alreadyProcessed: false, message: 'La preferencia no coincide con la orden' }
  }
  if (Number(payment.transaction_amount) !== order.amount || payment.currency_id !== order.currency) {
    return { success: false, alreadyProcessed: false, message: 'El importe o la moneda no coinciden con la orden' }
  }
  if (payment.metadata?.orderId !== undefined && payment.metadata.orderId !== order.id) {
    return { success: false, alreadyProcessed: false, message: 'Los metadatos no coinciden con la orden' }
  }

  const paymentId = String(payment.id)
  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, order.userId)
    const existingPayment = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
    if (existingPayment) {
      if (existingPayment.userId !== order.userId || existingPayment.orderId !== order.id) {
        return { success: false, alreadyProcessed: false, message: 'El pago no pertenece a esta orden' }
      }
      if (existingPayment.status !== 'approved') {
        return { success: false, alreadyProcessed: true, status: existingPayment.status, message: 'El pago ya fue revertido o requiere conciliación' }
      }
      const user = await transaction.user.findUnique({ where: { id: existingPayment.userId }, select: { tokens: true, tokenDebt: true } })
      return {
        success: true,
        alreadyProcessed: true,
        tokens: user?.tokens ?? 0,
        tokenDebt: user?.tokenDebt ?? 0,
        quantity: existingPayment.quantity ?? order.quantity,
      }
    }

    const claimedOrder = await transaction.paymentOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'paid', paymentId },
    })
    if (claimedOrder.count !== 1) {
      const paymentAfterRace = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
      if (paymentAfterRace?.status === 'approved' && paymentAfterRace.userId === order.userId && paymentAfterRace.orderId === order.id) {
        const user = await transaction.user.findUnique({ where: { id: paymentAfterRace.userId }, select: { tokens: true, tokenDebt: true } })
        return {
          success: true,
          alreadyProcessed: true,
          tokens: user?.tokens ?? 0,
          tokenDebt: user?.tokenDebt ?? 0,
          quantity: paymentAfterRace.quantity ?? order.quantity,
        }
      }
      return { success: false, alreadyProcessed: false, message: 'La orden ya fue procesada o no está pendiente' }
    }

    await transaction.processedPayment.create({
      data: {
        id: paymentId,
        userId: order.userId,
        orderId: order.id,
        quantity: order.quantity,
        amount: order.amount,
        currency: order.currency,
        status: 'approved',
        creditedQuantity: order.quantity,
      },
    })
    const currentUser = await transaction.user.findUnique({
      where: { id: order.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!currentUser) throw new Error('Payment order owner no longer exists')

    const debtPaid = Math.min(currentUser.tokenDebt, order.quantity)
    const tokensAdded = order.quantity - debtPaid
    const user = await transaction.user.update({
      where: { id: order.userId },
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
      quantity: order.quantity,
    }
  })
}

export async function applyLegacyApprovedPayment(payment: MercadoPagoPayment, userId: string): Promise<PaymentProcessingResult> {
  if (payment.external_reference !== userId) {
    return { success: false, alreadyProcessed: false, message: 'El pago anterior no pertenece a esta cuenta' }
  }
  if (getPaymentReversalStatus(payment)) {
    const result = await applyLegacyPaymentReversal(payment)
    return { ...result, success: false, message: result.message ?? 'El pago tiene una reversión y no puede acreditarse' }
  }
  const pack = getLegacyPackForPayment(payment)
  if (
    payment.status !== 'approved' ||
    payment.external_reference !== userId ||
    payment.metadata?.userId !== userId ||
    !pack
  ) {
    return { success: false, alreadyProcessed: false, message: 'El pago anterior no coincide con un paquete válido' }
  }

  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, userId)
    const existingPayment = await transaction.processedPayment.findUnique({ where: { id: String(payment.id) } })
    if (existingPayment) {
      if (existingPayment.userId !== userId || existingPayment.orderId !== null) {
        return { success: false, alreadyProcessed: false, message: 'El pago anterior no pertenece a esta cuenta' }
      }
      if (existingPayment.status !== 'approved') {
        return { success: false, alreadyProcessed: true, status: existingPayment.status, message: 'El pago ya fue revertido o requiere conciliación' }
      }
      const user = await transaction.user.findUnique({ where: { id: existingPayment.userId }, select: { tokens: true, tokenDebt: true } })
      return {
        success: true,
        alreadyProcessed: true,
        tokens: user?.tokens ?? 0,
        tokenDebt: user?.tokenDebt ?? 0,
        quantity: existingPayment.quantity ?? pack.quantity,
      }
    }

    const currentUser = await transaction.user.findUnique({
      where: { id: userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!currentUser) return { success: false, alreadyProcessed: false, message: 'Cuenta no encontrada' }

    await transaction.processedPayment.create({
      data: {
        id: String(payment.id),
        userId,
        quantity: pack.quantity,
        amount: pack.amount,
        currency: 'ARS',
        status: 'approved',
        creditedQuantity: pack.quantity,
      },
    })
    const debtPaid = Math.min(currentUser.tokenDebt, pack.quantity)
    const tokensAdded = pack.quantity - debtPaid
    const user = await transaction.user.update({
      where: { id: userId },
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
      quantity: pack.quantity,
    }
  })
}

export async function applyPaymentReversal(payment: MercadoPagoPayment): Promise<{
  success: boolean
  alreadyProcessed: boolean
  status?: string
  message?: string
  tokens?: number
  tokenDebt?: number
}> {
  const reversalStatus = getPaymentReversalStatus(payment)
  const isPartialRefund = reversalStatus === 'partial_refund_review'
  if (!reversalStatus) {
    return { success: false, alreadyProcessed: false, message: 'El pago no tiene un estado de reversión' }
  }

  const orderId = payment.external_reference
  const paymentId = String(payment.id)
  if (!orderId) {
    return { success: false, alreadyProcessed: false, message: 'El pago no está asociado a una orden válida' }
  }

  const order = await db.paymentOrder.findUnique({ where: { id: orderId } })
  if (!order) return { success: false, alreadyProcessed: false, message: 'La reversión no coincide con una orden pagada' }
  const preferenceId = await resolvePaymentPreferenceId(payment)
  if (!preferenceId || !order.preferenceId || order.providerOrderId || order.preferenceId !== preferenceId || (order.paymentId && order.paymentId !== paymentId)) {
    return { success: false, alreadyProcessed: false, message: 'La reversión no coincide con una orden pagada' }
  }
  if (Number(payment.transaction_amount) !== order.amount || payment.currency_id !== order.currency) {
    return { success: false, alreadyProcessed: false, message: 'El importe o la moneda no coinciden con la orden' }
  }

  if (isPartialRefund) {
    return db.$transaction(async (transaction) => {
      await lockUserForTokenUpdate(transaction, order.userId)
      const claimed = await transaction.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: ['pending', 'paid'] },
          OR: [{ paymentId: null }, { paymentId }],
        },
        data: { status: 'partial_refund_review', paymentId },
      })
      if (claimed.count !== 1) {
        const latest = await transaction.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })
        const final = latest.status === 'refunded' || latest.status === 'charged_back'
        return { success: final, alreadyProcessed: true, status: latest.status, message: final ? undefined : 'El reembolso parcial requiere conciliación manual' }
      }
      const processed = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
      if (!processed) {
        await transaction.processedPayment.create({
          data: { id: paymentId, userId: order.userId, orderId: order.id, quantity: order.quantity, amount: order.amount, currency: order.currency, status: 'partial_refund_review', creditedQuantity: 0 },
        })
      }
      await transaction.processedPayment.updateMany({
        where: { id: paymentId, status: 'approved' },
        data: { status: 'partial_refund_review' },
      })
      return { success: false, alreadyProcessed: false, status: 'partial_refund_review', message: 'El reembolso parcial requiere conciliación manual' }
    })
  }

  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, order.userId)
    let processed = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
    const claimedOrder = await transaction.paymentOrder.updateMany({
      where: {
        id: order.id,
        status: { in: ['pending', 'paid', 'partial_refund_review'] },
        OR: [{ paymentId: null }, { paymentId }],
      },
      data: { status: reversalStatus, paymentId },
    })
    if (claimedOrder.count !== 1) {
      const latestOrder = await transaction.paymentOrder.findUnique({ where: { id: order.id } })
      const user = await transaction.user.findUnique({ where: { id: order.userId }, select: { tokens: true, tokenDebt: true } })
      if (latestOrder?.status === 'refunded' || latestOrder?.status === 'charged_back') {
        return { success: true, alreadyProcessed: true, status: latestOrder.status, tokens: user?.tokens ?? 0, tokenDebt: user?.tokenDebt ?? 0 }
      }
      return { success: false, alreadyProcessed: false, message: 'La orden ya fue conciliada' }
    }

    if (!processed) processed = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
    if (!processed) {
      await transaction.processedPayment.create({
        data: { id: paymentId, userId: order.userId, orderId: order.id, quantity: order.quantity, amount: order.amount, currency: order.currency, status: reversalStatus, creditedQuantity: 0 },
      })
      const current = await transaction.user.findUniqueOrThrow({ where: { id: order.userId }, select: { tokens: true, tokenDebt: true } })
      return { success: true, alreadyProcessed: false, status: reversalStatus, ...current }
    }

    const user = await transaction.user.findUnique({
      where: { id: order.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!user) throw new Error('Payment order owner no longer exists')

    const creditedQuantity = processed.creditedQuantity ?? processed.quantity ?? order.quantity
    const tokensRemoved = Math.min(user.tokens, creditedQuantity)
    const remainingDebt = creditedQuantity - tokensRemoved
    await transaction.user.update({
      where: { id: order.userId },
      data: {
        tokens: { decrement: tokensRemoved },
        tokenDebt: { increment: remainingDebt },
        ...(creditedQuantity > 0 ? { isActive: false, activatedAt: null } : {}),
      },
    })
    await transaction.processedPayment.update({
      where: { id: paymentId },
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

export async function applyLegacyPaymentReversal(payment: MercadoPagoPayment): Promise<PaymentProcessingResult> {
  const reversalStatus = getPaymentReversalStatus(payment)
  const isPartialRefund = reversalStatus === 'partial_refund_review'
  const userId = payment.external_reference
  const pack = getLegacyPackForPayment(payment)

  if (
    !reversalStatus ||
    !userId ||
    payment.metadata?.userId !== userId ||
    !pack
  ) {
    return { success: false, alreadyProcessed: false, message: 'La reversión no coincide con un pago anterior válido' }
  }

  return db.$transaction(async (transaction) => {
    await lockUserForTokenUpdate(transaction, userId)
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!user) return { success: false, alreadyProcessed: false, message: 'Cuenta no encontrada' }

    const processed = await transaction.processedPayment.findUnique({ where: { id: String(payment.id) } })
    if (!processed) {
      // Persist a tombstone even when the refund overtook the approval request.
      // Zero creditedQuantity distinguishes this from a previously credited pack.
      await transaction.processedPayment.create({
        data: { id: String(payment.id), userId, quantity: pack.quantity, amount: pack.amount, currency: 'ARS', status: reversalStatus, creditedQuantity: 0 },
      })
      return { success: !isPartialRefund, alreadyProcessed: false, status: reversalStatus, tokens: user.tokens, tokenDebt: user.tokenDebt, message: isPartialRefund ? 'El reembolso parcial requiere conciliación manual' : undefined }
    }
    if (processed.orderId !== null || processed.userId !== userId) {
      return { success: false, alreadyProcessed: false, message: 'La reversión no pertenece al pago anterior' }
    }
    if (processed.status === 'refunded' || processed.status === 'charged_back') {
      return { success: true, alreadyProcessed: true, status: processed.status, tokens: user.tokens, tokenDebt: user.tokenDebt }
    }
    if (isPartialRefund) {
      await transaction.processedPayment.updateMany({
        where: { id: String(payment.id), status: 'approved', orderId: null },
        data: { status: 'partial_refund_review' },
      })
      return { success: false, alreadyProcessed: processed.status === 'partial_refund_review', status: reversalStatus, message: 'El reembolso parcial requiere conciliación manual' }
    }
    if (processed.status !== 'approved' && processed.status !== 'partial_refund_review') {
      return { success: false, alreadyProcessed: false, message: 'El pago anterior ya fue conciliado' }
    }

    const claimedPayment = await transaction.processedPayment.updateMany({
      where: { id: String(payment.id), status: { in: ['approved', 'partial_refund_review'] }, orderId: null },
      data: { status: reversalStatus },
    })
    if (claimedPayment.count !== 1) {
      return { success: false, alreadyProcessed: false, message: 'El pago anterior ya fue conciliado' }
    }

    const quantity = processed.creditedQuantity ?? processed.quantity ?? pack.quantity
    const tokensRemoved = Math.min(user.tokens, quantity)
    const remainingDebt = quantity - tokensRemoved
    await transaction.user.update({
      where: { id: processed.userId },
      data: {
        tokens: { decrement: tokensRemoved },
        tokenDebt: { increment: remainingDebt },
        ...(quantity > 0 ? { isActive: false, activatedAt: null } : {}),
      },
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
