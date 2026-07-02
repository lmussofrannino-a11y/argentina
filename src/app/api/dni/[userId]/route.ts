import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { consumeTokenIfExpired } from '@/lib/tokens'

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

    const { isActive, tokensLeft } = await consumeTokenIfExpired(userId)

    if (!isActive) {
      return NextResponse.json(
        { error: 'Cuenta sin tokens disponibles', expired: true, tokens: tokensLeft },
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
      { dni: dniData, tokens: tokensLeft },
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
