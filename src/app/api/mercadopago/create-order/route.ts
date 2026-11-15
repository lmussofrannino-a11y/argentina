import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/auth'
import { getPaymentPack } from '@/lib/payment-catalog'

function getPublicBaseUrl(request: NextRequest): string {
  const configuredUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.NODE_ENV === 'production' && !configuredUrl) {
    throw new Error('NEXT_PUBLIC_BASE_URL is required in production')
  }

  const url = new URL(configuredUrl || request.nextUrl.origin)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_BASE_URL must use HTTPS in production')
  }
  return url.origin
}

export async function POST(request: NextRequest) {
  const userId = getSessionUserId(request)
  if (!userId) return NextResponse.json({ error: 'Iniciá sesión para comprar' }, { status: 401 })

  try {
    const body = await request.json()
    const pack = getPaymentPack(body?.pack)
    if (!pack) return NextResponse.json({ error: 'El paquete seleccionado no es válido' }, { status: 400 })

    const accessToken = process.env.MERCADO_PAGO_ORDERS_ACCESS_TOKEN
    if (!accessToken) return NextResponse.json({ error: 'Mercado Pago Orders no está configurado' }, { status: 503 })

    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (!user) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 401 })

    const baseUrl = getPublicBaseUrl(request)
    const order = await db.paymentOrder.create({
      data: {
        userId,
        packId: pack.id,
        quantity: pack.quantity,
        amount: pack.amount,
        currency: 'ARS',
      },
    })

    const successUrl = new URL('/', baseUrl)
    successUrl.searchParams.set('payment_success', 'true')
    successUrl.searchParams.set('app_order_id', order.id)
    const failureUrl = new URL('/', baseUrl)
    failureUrl.searchParams.set('payment_failure', 'true')
    failureUrl.searchParams.set('app_order_id', order.id)
    const pendingUrl = new URL('/', baseUrl)
    pendingUrl.searchParams.set('payment_pending', 'true')
    pendingUrl.searchParams.set('app_order_id', order.id)

    const mpResponse = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'manual',
        total_amount: pack.amount.toFixed(2),
        external_reference: order.id,
        payer: { email: user.email },
        items: [{
          title: pack.title,
          quantity: pack.quantity,
          unit_price: (pack.amount / pack.quantity).toFixed(2),
        }],
        config: {
          online: {
            success_url: successUrl.toString(),
            failure_url: failureUrl.toString(),
            pending_url: pendingUrl.toString(),
            auto_return: 'approved',
          },
        },
      }),
    })

    const mpData = await mpResponse.json()
    if (!mpResponse.ok || typeof mpData.id !== 'string' || typeof mpData.checkout_url !== 'string') {
      await db.paymentOrder.update({ where: { id: order.id }, data: { status: 'failed' } })
      console.error('Mercado Pago order creation failed:', mpResponse.status)
      return NextResponse.json({ error: 'No se pudo iniciar el pago. Intentá nuevamente.' }, { status: 502 })
    }

    await db.paymentOrder.update({
      where: { id: order.id },
      data: { providerOrderId: mpData.id },
    })

    return NextResponse.json({ checkout_url: mpData.checkout_url, orderId: order.id })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error creating Mercado Pago order:', message)
    return NextResponse.json({ error: 'Error al crear el pago' }, { status: 500 })
  }
}
