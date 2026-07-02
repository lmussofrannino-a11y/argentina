import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    if (!userId) {
      return NextResponse.json(
        { error: 'ID de usuario requerido' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isActive: true, activatedAt: true },
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
          where: { id: userId },
          data: { isActive: false, activatedAt: null },
        })
        return NextResponse.json(
          { error: 'Tu cuenta ha expirado. Contactá al administrador para renovarla.', expired: true },
          { status: 403 }
        )
      }
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Cuenta no activada', expired: !user.activatedAt ? false : true },
        { status: 403 }
      )
    }

    const dniData = await db.dniData.findUnique({
      where: { userId },
    })

    if (!dniData) {
      return NextResponse.json(
        { error: 'Datos de DNI no encontrados para este usuario' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { dni: dniData },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error al obtener datos de DNI:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
