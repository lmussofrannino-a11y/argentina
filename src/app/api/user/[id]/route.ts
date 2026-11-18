import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { dniPublicSelect, withoutDniImages } from '@/lib/dni-response'
import { getSessionUserId } from '@/lib/auth'

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

    if (await getSessionUserId(request) !== id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Don't consume token on user info fetch - only when using DNI
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        isActive: true,
        tokens: true,
        tokenDebt: true,
        activatedAt: true,
        dni: { select: dniPublicSelect },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    const updatedUser = withoutDniImages(user)

    return NextResponse.json(
      { user: updatedUser },
      { status: 200, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    )
  } catch (error) {
    console.error('Error al obtener usuario:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
