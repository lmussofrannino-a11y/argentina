import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { consumeTokenIfExpired } from '@/lib/tokens'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'userId es requerido' },
        { status: 400 }
      )
    }

    // First consume any expired token
    const { isActive: afterExpiry, tokensLeft } = await consumeTokenIfExpired(userId)

    // If already active after expiry check, no need to use a new token
    if (afterExpiry) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { activatedAt: true, tokens: true },
      })
      return NextResponse.json({
        success: true,
        message: 'Ya tienes un token activo',
        isActive: true,
        activatedAt: user?.activatedAt,
        tokensLeft: user?.tokens ?? tokensLeft,
      })
    }

    // Check if user has tokens available
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tokens: true, isActive: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    if (user.tokens <= 0) {
      return NextResponse.json(
        {
          error: 'No tienes tokens disponibles. Comprá tokens en la sección Tina.',
          isActive: false,
          tokensLeft: 0,
        },
        { status: 400 }
      )
    }

    // Activate one token
    const updated = await db.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        activatedAt: new Date(),
        tokens: { decrement: 1 },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Token activado correctamente. Tu documento estará disponible por 24 horas.',
      isActive: true,
      activatedAt: updated.activatedAt,
      tokensLeft: updated.tokens,
    })
  } catch (error) {
    console.error('Error using token:', error)
    return NextResponse.json(
      { error: 'Error al usar el token' },
      { status: 500 }
    )
  }
}
