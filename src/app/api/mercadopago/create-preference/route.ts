import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { userId, email, title, quantity, unitPrice } = await req.json()

    if (!userId || !email || !title || !quantity || !unitPrice) {
      return NextResponse.json({
        error: 'Faltan datos requeridos',
        missing: { userId: !userId, email: !email, title: !title, quantity: !quantity, unitPrice: !unitPrice },
      }, { status: 400 })
    }

    const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token de Mercado Pago no configurado' }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'

    const body = {
      items: [
        {
          id: userId,
          title,
          description: `${quantity} token(s) para miArgentina`,
          quantity,
          unit_price: unitPrice / quantity,
          currency_id: 'ARS',
        },
      ],
      payer: { email },
      external_reference: userId,
      back_urls: {
        success: `${baseUrl}/?payment_success=true&quantity=${quantity}`,
        failure: `${baseUrl}/?payment_failure=true`,
        pending: `${baseUrl}/?payment_pending=true`,
      },
      notification_url: `${baseUrl}/api/mercadopago/verify-payment`,
      metadata: { userId, quantity },
    }

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const mpData = await mpRes.json()

    if (!mpRes.ok) {
      console.error('Mercado Pago API error:', mpRes.status, JSON.stringify(mpData))
      return NextResponse.json({
        error: 'Error de Mercado Pago',
        detail: mpData.message || mpData.error || JSON.stringify(mpData),
        status: mpRes.status,
      }, { status: 500 })
    }

    return NextResponse.json({
      init_point: mpData.init_point,
      preferenceId: mpData.id,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error creating Mercado Pago preference:', msg)
    return NextResponse.json({ error: 'Error al crear la preferencia de pago', detail: msg }, { status: 500 })
  }
}
