import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/auth'
import { getPaymentPack } from '@/lib/payment-catalog'
import { enforceRateLimit, readLimitedJson, RequestLimitError } from '@/lib/request-limits'

type Provider = 'orders' | 'preferences'

export async function createCheckout(request: NextRequest, provider: Provider) {
  let localOrderId: string | undefined
  let remoteCreationStarted = false
  try {
    const userId = await getSessionUserId(request)
    if (!userId) return NextResponse.json({ error: 'Iniciá sesión para comprar' }, { status: 401 })
    await enforceRateLimit('checkout', userId, 10, 5 * 60 * 1000)
    const body = await readLimitedJson(request)
    const pack = getPaymentPack(body.pack)
    if (!pack) return NextResponse.json({ error: 'El paquete seleccionado no es válido' }, { status: 400 })
    // Old clients can still buy; current clients persist and reuse attemptId.
    const attemptId = body.attemptId ?? randomUUID()
    if (typeof attemptId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attemptId)) {
      return NextResponse.json({ error: 'El intento de compra no es válido' }, { status: 400 })
    }
    const accessToken = provider === 'orders' ? process.env.MERCADO_PAGO_ORDERS_ACCESS_TOKEN : process.env.MERCADO_PAGO_ACCESS_TOKEN
    if (!accessToken) return NextResponse.json({ error: 'Mercado Pago no está configurado' }, { status: 503 })
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (!user) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 401 })

    const configuredUrl = process.env.NEXT_PUBLIC_BASE_URL
    if (process.env.NODE_ENV === 'production' && !configuredUrl) throw new Error('Missing public URL')
    const baseUrl = new URL(configuredUrl || request.nextUrl.origin)
    if (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:') throw new Error('HTTPS required')
    const id = createHash('sha256').update(`${userId}:${provider}:${attemptId}`).digest('hex')
    const order = await db.paymentOrder.upsert({
      where: { id },
      create: { id, userId, packId: pack.id, quantity: pack.quantity, amount: pack.amount, currency: 'ARS' },
      update: {},
    })
    localOrderId = id
    if (order.userId !== userId || order.packId !== pack.id) {
      return NextResponse.json({ error: 'Este intento pertenece a otro paquete' }, { status: 409 })
    }
    if (order.status !== 'pending') return NextResponse.json({ error: 'Este intento ya terminó. Iniciá una compra nueva.', resolved: true, orderId: id }, { status: 409 })

    const respond = (checkoutUrl: string, providerId: string) => NextResponse.json(provider === 'orders'
      ? { checkout_url: checkoutUrl, orderId: id }
      : { init_point: checkoutUrl, preferenceId: providerId, orderId: id })
    if (order.checkoutUrl) return respond(order.checkoutUrl, order.providerOrderId ?? order.preferenceId ?? '')

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    const stale = order.creationStartedAt && Date.now() - order.creationStartedAt.getTime() > 60000
    if (order.creationState === 'creating' && !stale) {
      return NextResponse.json({ error: 'La compra se está preparando. Reintentá con el mismo intento.', orderId: id }, { status: 409 })
    }

    let recoveredPreference: Record<string, unknown> | null = null
    // Preferences has no documented create idempotency guarantee. After an
    // unknown result, search/retrieve the existing preference; never POST blind.
    if (provider === 'preferences' && (order.preferenceId || order.creationState !== 'new')) {
      let preferenceId = order.preferenceId
      if (!preferenceId) {
        const search = await fetch(`https://api.mercadopago.com/checkout/preferences/search?external_reference=${encodeURIComponent(id)}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) })
        if (!search.ok) throw new Error('Preference recovery unavailable')
        const data = await search.json()
        const matches = Array.isArray(data.elements) ? data.elements.filter((entry: { external_reference?: string }) => entry.external_reference === id) : []
        if (matches.length !== 1) return NextResponse.json({ error: 'El resultado de esta compra todavía es desconocido. Reintentá para recuperar la misma operación.', orderId: id }, { status: 503 })
        preferenceId = matches[0].id
      }
      const response = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(String(preferenceId))}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error('Preference recovery unavailable')
      recoveredPreference = await response.json()
      if (recoveredPreference?.external_reference !== id) throw new Error('Preference association mismatch')
    }

    if (!recoveredPreference) {
      const claim = await db.paymentOrder.updateMany({
        where: { id, status: 'pending', OR: [{ creationState: { in: provider === 'orders' ? ['new', 'unknown'] : ['new'] } }, ...(provider === 'orders' ? [{ creationState: 'creating', creationStartedAt: { lte: new Date(Date.now() - 60000) } }] : [])] },
        data: { creationState: 'creating', creationStartedAt: new Date() },
      })
      if (claim.count !== 1) return NextResponse.json({ error: 'La compra se está preparando. Reintentá.', orderId: id }, { status: 409 })
    }

    const returnUrl = (flag: string) => {
      const url = new URL('/', baseUrl.origin)
      url.searchParams.set(flag, 'true')
      url.searchParams.set('app_order_id', id)
      return url.toString()
    }
    const success = returnUrl('payment_success'), failure = returnUrl('payment_failure'), pending = returnUrl('payment_pending')
    const payload = provider === 'orders' ? {
      type: 'online', processing_mode: 'manual', total_amount: pack.amount.toFixed(2), external_reference: id,
      payer: { email: user.email },
      items: [{ title: pack.title, quantity: pack.quantity, unit_price: (pack.amount / pack.quantity).toFixed(2) }],
      config: { online: { success_url: success, failure_url: failure, pending_url: pending, auto_return: 'approved' } },
    } : {
      items: [{ id: pack.id, title: pack.title, description: `${pack.quantity} token(s) para miArgentina`, quantity: pack.quantity, unit_price: pack.amount / pack.quantity, currency_id: 'ARS' }],
      payer: { email: user.email }, external_reference: id,
      back_urls: { success, failure, pending }, auto_return: 'approved',
      notification_url: `${baseUrl.origin}/api/mercadopago/verify-payment`, metadata: { orderId: id },
    }
    let mpData = recoveredPreference
    if (!mpData) {
      const creationPayload = order.creationPayload ?? payload
      if (!order.creationPayload) await db.paymentOrder.update({ where: { id }, data: { creationPayload } })
      remoteCreationStarted = true
      const response = await fetch(provider === 'orders' ? 'https://api.mercadopago.com/v1/orders' : 'https://api.mercadopago.com/checkout/preferences', {
        method: 'POST', headers: { ...headers, ...(provider === 'orders' ? { 'X-Idempotency-Key': id } : {}) },
        body: JSON.stringify(creationPayload), signal: AbortSignal.timeout(10000),
      })
      // An explicit validation rejection is a known failure; timeouts/5xx are not.
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409 && response.status !== 429) {
          await db.paymentOrder.update({ where: { id }, data: { status: 'failed', creationState: 'failed' } })
          return NextResponse.json({ error: 'No se pudo iniciar el pago. Iniciá un intento nuevo.', resolved: true, orderId: id }, { status: 502 })
        }
        throw new Error('Unknown remote creation result')
      }
      mpData = await response.json()
    }
    const providerId = mpData?.id
    const checkoutUrl = provider === 'orders' ? mpData?.checkout_url : mpData?.init_point
    if (typeof providerId !== 'string' || typeof checkoutUrl !== 'string' || new URL(checkoutUrl).protocol !== 'https:') throw new Error('Invalid remote checkout result')
    await db.paymentOrder.update({ where: { id }, data: { ...(provider === 'orders' ? { providerOrderId: providerId } : { preferenceId: providerId }), checkoutUrl, creationState: 'ready' } })
    await db.paymentReconciliationIssue.updateMany({ where: { id: `creation:${provider}:${id}` }, data: { status: 'resolved' } })
    return respond(checkoutUrl, providerId)
  } catch (error) {
    if (error instanceof RequestLimitError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (localOrderId && remoteCreationStarted) {
      try {
        await db.paymentOrder.update({ where: { id: localOrderId }, data: { creationState: 'unknown' } })
        await db.paymentReconciliationIssue.upsert({
          where: { id: `creation:${provider}:${localOrderId}` },
          create: { id: `creation:${provider}:${localOrderId}`, provider, resourceId: localOrderId, reason: 'Resultado de creación desconocido', status: 'retry' },
          update: { status: 'retry', attempts: { increment: 1 } },
        })
      } catch { console.error('Could not persist checkout recovery state') }
    }
    console.error('Checkout creation/recovery failed', { provider, orderId: localOrderId })
    return NextResponse.json({ error: 'No se pudo confirmar la creación. Reintentá para recuperar la misma compra.', orderId: localOrderId }, { status: 503 })
  }
}
