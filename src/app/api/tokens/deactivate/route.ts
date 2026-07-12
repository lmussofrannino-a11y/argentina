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
      select: { isActive: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        activatedAt: null,
        tokens: { decrement: 1 },
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Token expirado. Documento desactivado.',
      isActive: false,
      tokensLeft: updated.tokens,
    })
  } catch (error) {
    console.error('Error deactivating token:', error)
    return NextResponse.json(
      { error: 'Error al desactivar token' },
      { status: 500 }
    )
  }
}
