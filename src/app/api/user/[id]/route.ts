import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'ID de usuario requerido' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id },
      include: {
        dni: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    // Auto-deactivate if 24h since activation have passed
    if (user.isActive && user.activatedAt) {
      const hoursSinceActivation = (Date.now() - new Date(user.activatedAt).getTime()) / (1000 * 60 * 60)
      if (hoursSinceActivation >= 24) {
        await db.user.update({
          where: { id: user.id },
          data: { isActive: false, activatedAt: null },
        })
        return NextResponse.json(
          { error: 'Tu cuenta ha expirado. Contactá al administrador para renovarla.', expired: true },
          { status: 403 }
        )
      }
    }

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json(
      { user: userWithoutPassword },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error al obtener usuario:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

