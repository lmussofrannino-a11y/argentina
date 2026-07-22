import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'userId es requerido' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { tokens: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    // Always deactivate, but only decrement if there are tokens
    await db.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        activatedAt: null,
        tokens: user.tokens > 0 ? { decrement: 1 } : undefined,
      },
    })

    const tokensLeft = Math.max(0, user.tokens - 1)

    return NextResponse.json({
      success: true,
      message: 'Token expirado. Documento desactivado.',
      isActive: false,
      tokensLeft,
    })
  } catch (error) {
    console.error('Error deactivating token:', error)
    return NextResponse.json(
      { error: 'Error al desactivar token' },
      { status: 500 }
    )
  }
}
