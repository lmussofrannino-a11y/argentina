import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      )
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Email y contraseña deben ser texto' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { email },
      include: {
        dni: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      )
    }

    if (user.password !== password) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      )
    }

    // Don't consume token on login - only when using DNI
    const { password: _, ...userWithoutPassword } = user
    const updatedUser = { ...userWithoutPassword, isActive: user.isActive, tokens: user.tokens }

    if (!user.isActive && user.tokens === 0) {
      return NextResponse.json(
        {
          message: 'Tu cuenta no tiene tokens disponibles. Contactá al administrador.',
          user: updatedUser,
        },
        { status: 200 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        {
          message: 'Tu cuenta está pendiente de activación',
          user: updatedUser,
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        message: 'Inicio de sesión exitoso',
        user: updatedUser,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
