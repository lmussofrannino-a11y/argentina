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

    const { password: _, ...userWithoutPassword } = user

    // Auto-deactivate if 24h since activation have passed
    if (user.isActive && user.activatedAt) {
      const hoursSinceActivation = (Date.now() - new Date(user.activatedAt).getTime()) / (1000 * 60 * 60)
      if (hoursSinceActivation >= 24) {
        await db.user.update({
          where: { id: user.id },
          data: { isActive: false, activatedAt: null },
        })
        const expiredUser = { ...userWithoutPassword, isActive: false }
        return NextResponse.json(
          {
            message: 'Tu cuenta ha expirado. Contactá al administrador para renovarla.',
            user: expiredUser,
          },
          { status: 200 }
        )
      }
    }

    if (!user.isActive) {
      return NextResponse.json(
        {
          message: 'Tu cuenta está pendiente de activación',
          user: userWithoutPassword,
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        message: 'Inicio de sesión exitoso',
        user: userWithoutPassword,
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
