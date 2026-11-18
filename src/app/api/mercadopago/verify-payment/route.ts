import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/auth'
import { enforceRateLimit, readLimitedJson, RequestLimitError } from '@/lib/request-limits'
import {
  applyApprovedCheckoutOrder,
  applyCheckoutOrderReversal,
  fetchMercadoPagoOrder,
  getCheckoutOrderReversalStatus,
} from '@/lib/checkout-order-processing'
import {
  applyApprovedPayment,
  applyLegacyApprovedPayment,
  applyLegacyPaymentReversal,
  applyPaymentReversal,
  fetchMercadoPagoPayment,
  isValidMercadoPagoWebhook,
  getPaymentReversalStatus,
} from '@/lib/payment-processing'

async function verifyPendingOrder(userId: string, requestedOrderId: unknown, signal: AbortSignal) {
  if (requestedOrderId !== undefined && typeof requestedOrderId !== 'string') {
    return NextResponse.json({ error: 'La orden de pago no es válida' }, { status: 400 })
  }

  if (typeof requestedOrderId === 'string') return verifySingleOrder(userId, requestedOrderId, signal)
  // Bounded pagination: a newer unpaid checkout must not hide an older paid one.
  let fallback: NextResponse | null = null
  for (let page = 0; page < 2; page++) {
    const orders = await db.paymentOrder.findMany({
      where: { userId, status: { in: ['pending', 'paid', 'partial_refund_review'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page * 10,
      take: 10,
    })
    for (const order of orders) {
      signal.throwIfAborted()
      const response = await verifySingleOrder(userId, order.id, signal)
      const result = await response.clone().json()
      if ((result.success && !result.alreadyProcessed) || (['refunded', 'charged_back'].includes(result.status) && !result.alreadyProcessed)) return response
      if (result.status === 'partial_refund_review' && !fallback) fallback = response
      if (result.success) fallback = response
    }
    if (orders.length < 10) break
  }
  return fallback ?? NextResponse.json({ error: 'No se encontró un pago aprobado para conciliar', success: false }, { status: 404 })
}

async function verifySingleOrder(userId: string, requestedOrderId: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const order = await db.paymentOrder.findFirst({ where: { id: requestedOrderId, userId } })

  if (!order) return NextResponse.json({ error: 'No se encontró una orden pendiente' }, { status: 404 })

  if (order.providerOrderId) {
    const remoteOrder = await fetchMercadoPagoOrder(order.providerOrderId, signal)
    if (!remoteOrder || remoteOrder.id !== order.providerOrderId) {
      return NextResponse.json({ error: 'No se pudo consultar la order en Mercado Pago' }, { status: 502 })
    }

    if (remoteOrder.status === 'processed' && remoteOrder.status_detail === 'accredited' && !getCheckoutOrderReversalStatus(remoteOrder)) {
      const result = await applyApprovedCheckoutOrder(remoteOrder)
      return NextResponse.json(result, { status: result.success ? 200 : 409 })
    }
    if (getCheckoutOrderReversalStatus(remoteOrder)) {
      const result = await applyCheckoutOrderReversal(remoteOrder)
      return NextResponse.json(result, { status: result.success ? 200 : 409 })
    }
    return NextResponse.json({
      error: 'El pago todavía no está aprobado',
      status: remoteOrder.status,
      status_detail: remoteOrder.status_detail,
      success: false,
    }, { status: 409 })
  }

  if (!order.preferenceId) {
    return NextResponse.json({ error: 'La orden no está disponible para verificar' }, { status: 409 })
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) return NextResponse.json({ error: 'Mercado Pago no está configurado' }, { status: 503 })

  const searchUrl = new URL('https://api.mercadopago.com/v1/payments/search')
  searchUrl.searchParams.set('external_reference', order.id)
  searchUrl.searchParams.set('sort', 'date_created')
  searchUrl.searchParams.set('criteria', 'desc')
  searchUrl.searchParams.set('limit', '10')
  const searchResponse = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  })
  if (!searchResponse.ok) {
    return NextResponse.json({ error: 'No se pudo consultar el estado del pago' }, { status: 502 })
  }

  const searchData = await searchResponse.json()
  const paymentSummaries = Array.isArray(searchData.results) ? searchData.results : []
  for (const summary of paymentSummaries) {
    signal.throwIfAborted()
    if (summary?.id == null) continue

    const payment = await fetchMercadoPagoPayment(summary.id, signal)
    if (!payment) continue
    const result = getPaymentReversalStatus(payment) ? await applyPaymentReversal(payment) : await applyApprovedPayment(payment)
    if (result.success || result.status) return NextResponse.json({ ...result, error: result.message }, { status: result.success ? 200 : 409 })
    console.warn('Approved Mercado Pago payment did not match its order:', result.message)
  }

  const latestStatus = paymentSummaries[0]?.status
  if (latestStatus && latestStatus !== 'approved') {
    return NextResponse.json({
      error: 'El pago todavía no está aprobado',
      status: latestStatus,
      success: false,
    }, { status: 409 })
  }
  return NextResponse.json({ error: 'No se encontró un pago aprobado para esta orden', success: false }, { status: 404 })
}

async function verifyLegacyPayment(userId: string, signal: AbortSignal) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) return null

  const searchUrl = new URL('https://api.mercadopago.com/v1/payments/search')
  searchUrl.searchParams.set('external_reference', userId)
  searchUrl.searchParams.set('sort', 'date_created')
  searchUrl.searchParams.set('criteria', 'desc')
  searchUrl.searchParams.set('limit', '10')
  let fallback: NextResponse | null = null
  for (let page = 0; page < 2; page++) {
  searchUrl.searchParams.set('offset', String(page * 10))
  const response = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  })
  if (!response.ok) return null

  const data = await response.json()
  const summaries = Array.isArray(data.results) ? data.results : []
  for (const summary of summaries) {
    signal.throwIfAborted()
    if (summary?.id == null) continue
    const payment = await fetchMercadoPagoPayment(summary.id, signal)
    if (!payment) continue
    if (payment.external_reference !== userId) continue
    const result = getPaymentReversalStatus(payment) ? await applyLegacyPaymentReversal(payment) : await applyLegacyApprovedPayment(payment, userId)
    if (result.success && !result.alreadyProcessed) return NextResponse.json(result)
    if (result.status === 'partial_refund_review' && !fallback) fallback = NextResponse.json({ ...result, error: result.message }, { status: 409 })
    if (result.success) fallback = NextResponse.json(result)
  }
  if (summaries.length < 10) break
  }
  return fallback
}

async function acknowledgeProcessing(provider: string, resourceId: string, result: { success: boolean; alreadyProcessed: boolean; status?: string; message?: string }) {
  const id = `${provider}:${resourceId}`
  if (result.status !== 'partial_refund_review' && (result.success || result.alreadyProcessed)) {
    await db.paymentReconciliationIssue.updateMany({ where: { id }, data: { status: 'resolved' } })
    return NextResponse.json({ received: true })
  }
  const review = result.status === 'partial_refund_review'
  await db.paymentReconciliationIssue.upsert({
    where: { id },
    create: { id, provider, resourceId, reason: result.message ?? 'No se pudo conciliar', status: review ? 'review' : 'retry' },
    update: { reason: result.message ?? 'No se pudo conciliar', status: review ? 'review' : 'retry', attempts: { increment: 1 } },
  })
  return NextResponse.json({ received: review, error: review ? undefined : 'Conciliación pendiente; reintentar' }, { status: review ? 200 : 503 })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    const parsedBody = await readLimitedJson(request)
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: 'Solicitud no válida' }, { status: 400 })
    }
    body = parsedBody as Record<string, unknown>
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestLimitError ? error.message : 'Solicitud no válida' }, { status: error instanceof RequestLimitError ? error.status : 400 })
  }

  const type = body.type ?? request.nextUrl.searchParams.get('type')
  const { data } = body
  if (type === 'order') {
    const bodyDataId = data && typeof data === 'object' && 'id' in data
      ? (data as { id?: unknown }).id
      : undefined
    const queryDataId = request.nextUrl.searchParams.get('data.id')
    const dataId = queryDataId ?? (typeof bodyDataId === 'string' || typeof bodyDataId === 'number' ? String(bodyDataId) : null)
    if (!dataId) return NextResponse.json({ error: 'Notificación de order no válida' }, { status: 400 })

    const webhookSecret = process.env.MERCADO_PAGO_ORDERS_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('MERCADO_PAGO_ORDERS_WEBHOOK_SECRET is not configured')
      return NextResponse.json({ error: 'Webhook de Orders no configurado' }, { status: 503 })
    }
    if (!isValidMercadoPagoWebhook(request, dataId, webhookSecret)) {
      return NextResponse.json({ error: 'Firma de notificación inválida' }, { status: 401 })
    }

    const order = await fetchMercadoPagoOrder(dataId)
    if (!order || order.id !== dataId) {
      return NextResponse.json({ error: 'No se pudo verificar la order en Mercado Pago' }, { status: 502 })
    }

    if (order.status === 'processed' && order.status_detail === 'accredited' && !getCheckoutOrderReversalStatus(order)) {
      const result = await applyApprovedCheckoutOrder(order)
      return acknowledgeProcessing('orders', dataId, result)
    } else if (getCheckoutOrderReversalStatus(order)) {
      const result = await applyCheckoutOrderReversal(order)
      return acknowledgeProcessing('orders', dataId, result)
    }
    return NextResponse.json({ received: true })
  }

  if (type === 'payment' && data && typeof data === 'object' && 'id' in data) {
    const dataId = (data as { id?: unknown }).id
    if (typeof dataId !== 'string' && typeof dataId !== 'number') {
      return NextResponse.json({ error: 'Notificación de pago no válida' }, { status: 400 })
    }
    if (!process.env.MERCADO_PAGO_WEBHOOK_SECRET) {
      console.error('MERCADO_PAGO_WEBHOOK_SECRET is not configured')
      return NextResponse.json({ error: 'Webhook de Mercado Pago no configurado' }, { status: 503 })
    }
    if (!isValidMercadoPagoWebhook(request, String(dataId))) {
      return NextResponse.json({ error: 'Firma de notificación inválida' }, { status: 401 })
    }

    const payment = await fetchMercadoPagoPayment(dataId)
    if (!payment || String(payment.id) !== String(dataId)) {
      return NextResponse.json({ error: 'No se pudo verificar el pago en Mercado Pago' }, { status: 502 })
    }

    if (payment.status === 'approved' && !getPaymentReversalStatus(payment)) {
      let result = await applyApprovedPayment(payment)
      if (!result.success && result.message === 'Orden de pago no encontrada' && payment.external_reference) {
        result = await applyLegacyApprovedPayment(payment, payment.external_reference)
      }
      return acknowledgeProcessing('payments', String(dataId), result)
    } else if (getPaymentReversalStatus(payment)) {
      let result = await applyPaymentReversal(payment)
      if (!result.success && result.message === 'La reversión no coincide con una orden pagada') {
        result = await applyLegacyPaymentReversal(payment)
      }
      return acknowledgeProcessing('payments', String(dataId), result)
    }
    return NextResponse.json({ received: true })
  }

  if (type === 'payment') {
    return NextResponse.json({ error: 'Notificación de pago no válida' }, { status: 400 })
  }
  if (typeof type === 'string') return NextResponse.json({ received: true })

  const userId = await getSessionUserId(request)
  if (!userId) return NextResponse.json({ error: 'Iniciá sesión para verificar el pago' }, { status: 401 })

  try {
    await enforceRateLimit('verify-payment', userId, 20, 5 * 60 * 1000)
    const signal = AbortSignal.timeout(20000)
    const orderResponse = await verifyPendingOrder(userId, body.orderId, signal)
    const orderResult = await orderResponse.clone().json()
    if (body.orderId !== undefined || (orderResult.success && !orderResult.alreadyProcessed) || orderResult.status === 'partial_refund_review') {
      return orderResponse
    }
    return await verifyLegacyPayment(userId, signal) ?? orderResponse
  } catch (error: unknown) {
    if (error instanceof RequestLimitError) return NextResponse.json({ error: error.message }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error verifying Mercado Pago order:', message)
    return NextResponse.json({ error: 'No se pudo verificar el pago' }, { status: 500 })
  }
}
