import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { consumeTokenIfExpired } from '@/lib/tokens'

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

    // Consume token if current one expired, or activate next token
    const { isActive, tokensLeft } = await consumeTokenIfExpired(id)

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

    const { password: _, ...userWithoutPassword } = user
    const updatedUser = { ...userWithoutPassword, isActive, tokens: tokensLeft }

    return NextResponse.json(
      { user: updatedUser },
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
