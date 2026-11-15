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

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
    if (!accessToken) return NextResponse.json({ error: 'Mercado Pago no está configurado' }, { status: 503 })

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

    const paymentUrl = new URL('/', baseUrl)
    paymentUrl.searchParams.set('payment_success', 'true')
    paymentUrl.searchParams.set('order_id', order.id)
    const failureUrl = new URL('/', baseUrl)
    failureUrl.searchParams.set('payment_failure', 'true')
    failureUrl.searchParams.set('order_id', order.id)
    const pendingUrl = new URL('/', baseUrl)
    pendingUrl.searchParams.set('payment_pending', 'true')
    pendingUrl.searchParams.set('order_id', order.id)

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          id: pack.id,
          title: pack.title,
          description: `${pack.quantity} token(s) para miArgentina`,
          quantity: pack.quantity,
          unit_price: pack.amount / pack.quantity,
          currency_id: 'ARS',
        }],
        payer: { email: user.email },
        external_reference: order.id,
        back_urls: {
          success: paymentUrl.toString(),
          failure: failureUrl.toString(),
          pending: pendingUrl.toString(),
        },
        notification_url: `${baseUrl}/api/mercadopago/verify-payment`,
        metadata: { orderId: order.id },
      }),
    })

    const mpData = await mpResponse.json()
    if (!mpResponse.ok || typeof mpData.id !== 'string' || typeof mpData.init_point !== 'string') {
      await db.paymentOrder.update({ where: { id: order.id }, data: { status: 'failed' } })
      console.error('Mercado Pago preference creation failed:', mpResponse.status)
      return NextResponse.json({ error: 'No se pudo iniciar el pago. Intentá nuevamente.' }, { status: 502 })
    }

    await db.paymentOrder.update({
      where: { id: order.id },
      data: { preferenceId: mpData.id },
    })

    return NextResponse.json({
      init_point: mpData.init_point,
      preferenceId: mpData.id,
      orderId: order.id,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error creating Mercado Pago preference:', message)
    return NextResponse.json({ error: 'Error al crear el pago' }, { status: 500 })
  }
}
