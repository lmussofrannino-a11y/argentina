import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { consumeTokenIfExpired } from '@/lib/tokens'
import { getSessionUserId } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'userId es requerido' },
        { status: 400 }
      )
    }

    if (await getSessionUserId(req) !== userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // One transaction owns expiry and activation; never try a second decrement here.
    const result = await consumeTokenIfExpired(userId)

    if (result.blockedReason === 'debt') {
      return NextResponse.json(
        {
          error: 'Tu cuenta tiene un ajuste de tokens pendiente. Comprá un paquete para regularizarla.',
          isActive: false,
          tokensLeft: result.tokensLeft,
          tokenDebt: result.tokenDebt,
        },
        { status: 400 }
      )
    }

    if (result.activated) {
      return NextResponse.json({
        success: true,
        message: 'Token activado correctamente. Tu documento estará disponible por 24 horas.',
        isActive: true,
        activatedAt: result.activatedAt,
        tokensLeft: result.tokensLeft,
        tokenDebt: result.tokenDebt,
      })
    }

    if (result.isActive) {
      return NextResponse.json({
        success: true,
        message: 'Ya tienes un token activo',
        isActive: true,
        activatedAt: result.activatedAt,
        tokensLeft: result.tokensLeft,
        tokenDebt: result.tokenDebt,
      })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tokens: true, tokenDebt: true },
    })

    return NextResponse.json(
      {
        error: 'No tienes tokens disponibles. Comprá tokens en la sección Tina.',
        isActive: false,
        tokensLeft: user?.tokens ?? result.tokensLeft,
        tokenDebt: user?.tokenDebt ?? result.tokenDebt,
      },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error using token:', error)
    return NextResponse.json(
      { error: 'Error al usar el token' },
      { status: 500 }
    )
  }
}
