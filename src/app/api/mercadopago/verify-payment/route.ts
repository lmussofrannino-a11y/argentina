import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN!

async function verifyPayment(paymentId: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
  })
  if (!res.ok) return null
  return res.json()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Handle webhook notification from Mercado Pago
    const { type, data } = body
    if (type === 'payment' && data?.id) {
      const paymentId = String(data.id)
      const existing = await db.processedPayment.findUnique({ where: { id: paymentId } })
      if (!existing) {
        const payment = await verifyPayment(paymentId)
        if (payment && payment.status === 'approved') {
          const userId = payment.metadata?.userId as string || payment.external_reference as string
          const quantity = (payment.metadata?.quantity as number) || 1
          if (userId) {
            await db.user.update({
              where: { id: userId },
              data: { tokens: { increment: quantity } },
            })
            await db.processedPayment.create({ data: { id: paymentId, userId } })
          }
        }
      }
      return NextResponse.json({ received: true })
    }

    // Handle direct verification from frontend by userId (external_reference)
    const { userId } = body
    if (!userId) {
      return NextResponse.json({ error: 'userId es requerido' }, { status: 400 })
    }

    const searchRes = await fetch(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${userId}&sort=date_created&criteria=desc&limit=1`,
      { headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` } },
    )
    const searchData = await searchRes.json()

    if (!searchData.results || searchData.results.length === 0) {
      return NextResponse.json({ error: 'No se encontraron pagos', success: false }, { status: 404 })
    }

    const lastPayment = searchData.results[0]
    const paymentId = String(lastPayment.id)

    if (lastPayment.status !== 'approved') {
      return NextResponse.json({
        error: `El pago está en estado: ${lastPayment.status}`,
        status: lastPayment.status,
        success: false,
      }, { status: 400 })
    }

    const quantity = (lastPayment.metadata?.quantity as number) || 1

    const user = await db.user.findUnique({ where: { id: userId }, select: { tokens: true } })
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const alreadyProcessed = await db.processedPayment.findUnique({ where: { id: paymentId } })
    if (alreadyProcessed) {
      return NextResponse.json({
        success: true,
        tokens: user.tokens,
        quantity,
        message: 'Este pago ya fue acreditado',
      })
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: { tokens: { increment: quantity } },
    })

    await db.processedPayment.create({ data: { id: paymentId, userId } })

    return NextResponse.json({
      success: true,
      tokens: updated.tokens,
      quantity,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error verifying Mercado Pago payment:', msg)
    return NextResponse.json({ error: 'Error al verificar el pago', detail: msg }, { status: 500 })
  }
}
