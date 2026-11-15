import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/auth'
import {
  applyApprovedCheckoutOrder,
  applyCheckoutOrderReversal,
  fetchMercadoPagoOrder,
} from '@/lib/checkout-order-processing'
import {
  applyApprovedPayment,
  applyLegacyApprovedPayment,
  applyLegacyPaymentReversal,
  applyPaymentReversal,
  fetchMercadoPagoPayment,
  isValidMercadoPagoWebhook,
} from '@/lib/payment-processing'

async function verifyPendingOrder(userId: string, requestedOrderId: unknown) {
  if (requestedOrderId !== undefined && typeof requestedOrderId !== 'string') {
    return NextResponse.json({ error: 'La orden de pago no es válida' }, { status: 400 })
  }

  const order = typeof requestedOrderId === 'string'
    ? await db.paymentOrder.findFirst({ where: { id: requestedOrderId, userId } })
    : await db.paymentOrder.findFirst({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      })

  if (!order) return NextResponse.json({ error: 'No se encontró una orden pendiente' }, { status: 404 })

  if (order.status === 'paid') {
    const processed = await db.processedPayment.findFirst({ where: { orderId: order.id } })
    const user = await db.user.findUnique({ where: { id: userId }, select: { tokens: true, tokenDebt: true } })
    return NextResponse.json({
      success: true,
      alreadyProcessed: true,
      tokens: user?.tokens ?? 0,
      tokenDebt: user?.tokenDebt ?? 0,
      quantity: processed?.quantity ?? order.quantity,
    })
  }

  if (order.providerOrderId) {
    const remoteOrder = await fetchMercadoPagoOrder(order.providerOrderId)
    if (!remoteOrder || remoteOrder.id !== order.providerOrderId) {
      return NextResponse.json({ error: 'No se pudo consultar la order en Mercado Pago' }, { status: 502 })
    }

    if (remoteOrder.status === 'processed' && remoteOrder.status_detail === 'accredited') {
      const result = await applyApprovedCheckoutOrder(remoteOrder)
      return NextResponse.json(result, { status: result.success ? 200 : 409 })
    }
    if (remoteOrder.status === 'refunded' || remoteOrder.status === 'charged_back' || remoteOrder.status_detail === 'partially_refunded') {
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

  if (order.status !== 'pending' || !order.preferenceId) {
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
  })
  if (!searchResponse.ok) {
    return NextResponse.json({ error: 'No se pudo consultar el estado del pago' }, { status: 502 })
  }

  const searchData = await searchResponse.json()
  const paymentSummaries = Array.isArray(searchData.results) ? searchData.results : []
  for (const summary of paymentSummaries) {
    if (summary?.status !== 'approved' || summary?.id == null) continue

    const payment = await fetchMercadoPagoPayment(summary.id)
    if (!payment) continue
    const result = await applyApprovedPayment(payment)
    if (result.success) return NextResponse.json(result)
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

async function verifyLegacyPayment(userId: string) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!accessToken) return null

  const searchUrl = new URL('https://api.mercadopago.com/v1/payments/search')
  searchUrl.searchParams.set('external_reference', userId)
  searchUrl.searchParams.set('sort', 'date_created')
  searchUrl.searchParams.set('criteria', 'desc')
  searchUrl.searchParams.set('limit', '10')
  const response = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) return null

  const data = await response.json()
  const summaries = Array.isArray(data.results) ? data.results : []
  for (const summary of summaries) {
    if (summary?.status !== 'approved' || summary?.id == null) continue
    const payment = await fetchMercadoPagoPayment(summary.id)
    if (!payment) continue
    const result = await applyLegacyApprovedPayment(payment, userId)
    if (result.success) return NextResponse.json(result)
  }
  return null
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    const parsedBody = await request.json()
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: 'Solicitud no válida' }, { status: 400 })
    }
    body = parsedBody as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Solicitud no válida' }, { status: 400 })
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

    if (order.status === 'processed' && order.status_detail === 'accredited') {
      const result = await applyApprovedCheckoutOrder(order)
      if (!result.success) console.warn('Mercado Pago order was not credited:', result.message)
    } else if (order.status === 'refunded' || order.status === 'charged_back' || order.status_detail === 'partially_refunded') {
      const result = await applyCheckoutOrderReversal(order)
      if (!result.success) console.warn('Mercado Pago order reversal needs reconciliation:', result.message)
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

    if (payment.status === 'approved' && !Number(payment.transaction_amount_refunded ?? 0)) {
      const result = await applyApprovedPayment(payment)
      if (!result.success && result.message === 'Orden de pago no encontrada' && payment.external_reference) {
        const legacyResult = await applyLegacyApprovedPayment(payment, payment.external_reference)
        if (!legacyResult.success) console.warn('Legacy Mercado Pago payment was not credited:', legacyResult.message)
      } else if (!result.success) {
        console.warn('Mercado Pago payment was not credited:', result.message)
      }
    } else if (
      payment.status === 'refunded' ||
      payment.status === 'charged_back' ||
      Number(payment.transaction_amount_refunded ?? 0) > 0
    ) {
      const result = await applyPaymentReversal(payment)
      if (!result.success && result.message === 'La reversión no coincide con una orden pagada') {
        const legacyResult = await applyLegacyPaymentReversal(payment)
        if (!legacyResult.success) console.warn('Legacy Mercado Pago reversal needs reconciliation:', legacyResult.message)
      } else if (!result.success) {
        console.warn('Mercado Pago payment reversal needs reconciliation:', result.message)
      }
    }
    return NextResponse.json({ received: true })
  }

  if (type === 'payment') {
    return NextResponse.json({ error: 'Notificación de pago no válida' }, { status: 400 })
  }
  if (typeof type === 'string') return NextResponse.json({ received: true })

  const userId = getSessionUserId(request)
  if (!userId) return NextResponse.json({ error: 'Iniciá sesión para verificar el pago' }, { status: 401 })

  try {
    const orderResponse = await verifyPendingOrder(userId, body.orderId)
    if (body.orderId !== undefined || (orderResponse.status !== 404 && orderResponse.status !== 409)) {
      return orderResponse
    }
    return await verifyLegacyPayment(userId) ?? orderResponse
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error verifying Mercado Pago order:', message)
    return NextResponse.json({ error: 'No se pudo verificar el pago' }, { status: 500 })
  }
}
