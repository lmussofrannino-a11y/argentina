import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const adminKey = request.headers.get('x-admin-key')

    if (adminKey !== 'gomitas24') {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { userId, isActive, addTokens } = await request.json()

    if (!userId) {
      return NextResponse.json(
        { error: 'userId es requerido' },
        { status: 400 }
      )
    }

    const existingUser = await db.user.findUnique({ where: { id: userId } })
    if (!existingUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // If adding tokens
    if (addTokens && typeof addTokens === 'number' && addTokens > 0) {
      const updated = await db.user.update({
        where: { id: userId },
        data: { tokens: existingUser.tokens + addTokens },
        include: { dni: true },
      })
      const { password: _, ...userWithoutPassword } = updated
      return NextResponse.json(
        {
          message: `Se agregaron ${addTokens} token(s). Total: ${updated.tokens}`,
          user: userWithoutPassword,
        },
        { status: 200 }
      )
    }

    // Legacy toggle activation (keep for backward compat)
    if (typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive (boolean) o addTokens (number) son requeridos' },
        { status: 400 }
      )
    }

    let updatedUser

    if (!isActive) {
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { isActive: false, activatedAt: null },
        include: { dni: true },
      })
    } else if (existingUser.activatedAt) {
      const hoursSinceActivation = (Date.now() - new Date(existingUser.activatedAt).getTime()) / (1000 * 60 * 60)
      if (hoursSinceActivation < 24) {
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true },
          include: { dni: true },
        })
      } else {
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true, activatedAt: new Date() },
          include: { dni: true },
        })
      }
    } else {
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { isActive: true, activatedAt: new Date() },
        include: { dni: true },
      })
    }

    const { password: _, ...userWithoutPassword } = updatedUser

    return NextResponse.json(
      {
        message: isActive ? 'Cuenta activada exitosamente' : 'Cuenta desactivada',
        user: userWithoutPassword,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error al activar usuario:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
