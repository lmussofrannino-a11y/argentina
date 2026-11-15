import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
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
}

function getLegacyPackForPayment(payment: MercadoPagoPayment) {
  if (payment.currency_id !== 'ARS') return null
  return Object.values(PAYMENT_PACKS).find((pack) => pack.amount === Number(payment.transaction_amount)) ?? null
}

export async function fetchMercadoPagoPayment(paymentId: string | number): Promise<MercadoPagoPayment | null> {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not configured')

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) return null

  const payment = await response.json()
  if (!payment || typeof payment !== 'object' || !('id' in payment)) return null
  return payment as MercadoPagoPayment
}

export function isValidMercadoPagoWebhook(request: NextRequest, dataId: string): boolean {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
  const requestId = request.headers.get('x-request-id')
  const signatureHeader = request.headers.get('x-signature')
  if (!secret || !requestId || !signatureHeader) return false

  const values = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const separator = part.indexOf('=')
      return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
    }).filter(([key, value]) => key && value),
  )
  if (!values.ts || !values.v1) return false

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
}> {
  if (payment.status !== 'approved') {
    return { success: false, alreadyProcessed: false, message: 'El pago no está aprobado' }
  }

  const orderId = payment.external_reference
  const preferenceId = payment.preference_id == null ? null : String(payment.preference_id)
  if (!orderId || !preferenceId) {
    return { success: false, alreadyProcessed: false, message: 'El pago no está asociado a una orden válida' }
  }

  const order = await db.paymentOrder.findUnique({ where: { id: orderId } })
  if (!order) return { success: false, alreadyProcessed: false, message: 'Orden de pago no encontrada' }
  if (order.preferenceId !== preferenceId) {
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
    const existingPayment = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
    if (existingPayment) {
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
      if (paymentAfterRace) {
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

export async function applyLegacyApprovedPayment(payment: MercadoPagoPayment, userId: string) {
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
    const existingPayment = await transaction.processedPayment.findUnique({ where: { id: String(payment.id) } })
    if (existingPayment) {
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
  const isPartialRefund = Number(payment.transaction_amount_refunded ?? 0) > 0 &&
    Number(payment.transaction_amount_refunded) < Number(payment.transaction_amount)
  const reversalStatus = isPartialRefund ? 'partial_refund_review' : payment.status
  if (!isPartialRefund && reversalStatus !== 'refunded' && reversalStatus !== 'charged_back') {
    return { success: false, alreadyProcessed: false, message: 'El pago no tiene un estado de reversión' }
  }

  const orderId = payment.external_reference
  const preferenceId = payment.preference_id == null ? null : String(payment.preference_id)
  const paymentId = String(payment.id)
  if (!orderId || !preferenceId) {
    return { success: false, alreadyProcessed: false, message: 'El pago no está asociado a una orden válida' }
  }

  const order = await db.paymentOrder.findUnique({ where: { id: orderId } })
  if (!order || order.preferenceId !== preferenceId || (order.paymentId && order.paymentId !== paymentId)) {
    return { success: false, alreadyProcessed: false, message: 'La reversión no coincide con una orden pagada' }
  }
  if (Number(payment.transaction_amount) !== order.amount || payment.currency_id !== order.currency) {
    return { success: false, alreadyProcessed: false, message: 'El importe o la moneda no coinciden con la orden' }
  }

  if (isPartialRefund) {
    await db.$transaction(async (transaction) => {
      await transaction.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: { in: ['pending', 'paid'] },
          OR: [{ paymentId: null }, { paymentId }],
        },
        data: { status: 'partial_refund_review', paymentId },
      })
      await transaction.processedPayment.updateMany({
        where: { id: paymentId, status: 'approved' },
        data: { status: 'partial_refund_review' },
      })
    })
    return { success: false, alreadyProcessed: false, status: 'partial_refund_review', message: 'El reembolso parcial requiere conciliación manual' }
  }

  return db.$transaction(async (transaction) => {
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
      if (latestOrder?.status === reversalStatus) {
        return { success: true, alreadyProcessed: true, status: reversalStatus, tokens: user?.tokens ?? 0, tokenDebt: user?.tokenDebt ?? 0 }
      }
      return { success: false, alreadyProcessed: false, message: 'La orden ya fue conciliada' }
    }

    if (!processed) processed = await transaction.processedPayment.findUnique({ where: { id: paymentId } })
    if (!processed) {
      return { success: true, alreadyProcessed: false, status: reversalStatus, tokens: 0, tokenDebt: 0 }
    }

    const user = await transaction.user.findUnique({
      where: { id: order.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!user) throw new Error('Payment order owner no longer exists')

    const tokensRemoved = Math.min(user.tokens, order.quantity)
    const remainingDebt = order.quantity - tokensRemoved
    await transaction.user.update({
      where: { id: order.userId },
      data: {
        tokens: { decrement: tokensRemoved },
        tokenDebt: { increment: remainingDebt },
        isActive: false,
        activatedAt: null,
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

export async function applyLegacyPaymentReversal(payment: MercadoPagoPayment) {
  const isPartialRefund = Number(payment.transaction_amount_refunded ?? 0) > 0 &&
    Number(payment.transaction_amount_refunded) < Number(payment.transaction_amount)
  const reversalStatus = isPartialRefund ? 'partial_refund_review' : payment.status
  const userId = payment.external_reference
  const pack = getLegacyPackForPayment(payment)

  if (
    (!isPartialRefund && reversalStatus !== 'refunded' && reversalStatus !== 'charged_back') ||
    !userId ||
    payment.metadata?.userId !== userId ||
    !pack
  ) {
    return { success: false, alreadyProcessed: false, message: 'La reversión no coincide con un pago anterior válido' }
  }

  if (isPartialRefund) {
    await db.processedPayment.updateMany({
      where: { id: String(payment.id), status: 'approved', orderId: null },
      data: { status: 'partial_refund_review' },
    })
    return { success: false, alreadyProcessed: false, status: 'partial_refund_review', message: 'El reembolso parcial requiere conciliación manual' }
  }

  return db.$transaction(async (transaction) => {
    const processed = await transaction.processedPayment.findUnique({ where: { id: String(payment.id) } })
    if (!processed || processed.orderId !== null) {
      return { success: false, alreadyProcessed: false, message: 'No existe un pago anterior para revertir' }
    }
    if (processed.status === reversalStatus) {
      const user = await transaction.user.findUnique({ where: { id: processed.userId }, select: { tokens: true, tokenDebt: true } })
      return { success: true, alreadyProcessed: true, status: reversalStatus, tokens: user?.tokens ?? 0, tokenDebt: user?.tokenDebt ?? 0 }
    }
    if (processed.status !== 'approved') {
      return { success: false, alreadyProcessed: false, message: 'El pago anterior ya fue conciliado' }
    }

    const claimedPayment = await transaction.processedPayment.updateMany({
      where: { id: String(payment.id), status: 'approved', orderId: null },
      data: { status: reversalStatus },
    })
    if (claimedPayment.count !== 1) {
      return { success: false, alreadyProcessed: false, message: 'El pago anterior ya fue conciliado' }
    }

    const user = await transaction.user.findUnique({
      where: { id: processed.userId },
      select: { tokens: true, tokenDebt: true },
    })
    if (!user) throw new Error('Legacy payment owner no longer exists')

    const quantity = processed.quantity ?? pack.quantity
    const tokensRemoved = Math.min(user.tokens, quantity)
    const remainingDebt = quantity - tokensRemoved
    await transaction.user.update({
      where: { id: processed.userId },
      data: {
        tokens: { decrement: tokensRemoved },
        tokenDebt: { increment: remainingDebt },
        isActive: false,
        activatedAt: null,
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
