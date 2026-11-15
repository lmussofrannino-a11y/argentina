import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { dniPublicSelect, withoutDniImages } from '@/lib/dni-response'
import { createSessionToken, setSessionCookie } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/password'

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

    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 1024) {
      return NextResponse.json(
        { error: 'Email o contraseña no válidos' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    const loginSelect = {
      id: true,
      email: true,
      password: true,
      isActive: true,
      tokens: true,
      tokenDebt: true,
      activatedAt: true,
      dni: { select: dniPublicSelect },
    } as const

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: loginSelect,
    }) ?? await db.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' } },
      select: loginSelect,
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      )
    }

    const passwordCheck = await verifyPassword(password, user.password)
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      )
    }

    const sessionToken = createSessionToken(user.id)
    if (passwordCheck.needsRehash) {
      await db.user.update({
        where: { id: user.id },
        data: { password: await hashPassword(password) },
      })
    }

    // Don't consume token on login - only when using DNI
    const { password: _, ...userWithoutPassword } = user
    const updatedUser = withoutDniImages({ ...userWithoutPassword, isActive: user.isActive, tokens: user.tokens })

    if (!user.isActive && user.tokens === 0) {
      const response = NextResponse.json(
        {
          message: 'Tu cuenta no tiene tokens disponibles. Contactá al administrador.',
          user: updatedUser,
        },
        { status: 200 }
      )
      setSessionCookie(response, sessionToken)
      return response
    }

    if (!user.isActive) {
      const response = NextResponse.json(
        {
          message: 'Tu cuenta está pendiente de activación',
          user: updatedUser,
        },
        { status: 200 }
      )
      setSessionCookie(response, sessionToken)
      return response
    }

    const response = NextResponse.json(
      {
        message: 'Inicio de sesión exitoso',
        user: updatedUser,
      },
      { status: 200 }
    )
    setSessionCookie(response, sessionToken)
    return response
  } catch (error) {
    console.error('Error en login:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
