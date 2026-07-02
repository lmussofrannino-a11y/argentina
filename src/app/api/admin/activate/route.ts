import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/activate - Activate or deactivate a user
export async function POST(request: NextRequest) {
  try {
    const adminKey = request.headers.get('x-admin-key')

    if (adminKey !== 'admin123') {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { userId, isActive } = await request.json()

    if (!userId || typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'userId (string) e isActive (boolean) son requeridos' },
        { status: 400 }
      )
    }

    const existingUser = await db.user.findUnique({ where: { id: userId } })
    if (!existingUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
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
        // Re-activate without resetting timer
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true },
          include: { dni: true },
        })
      } else {
        // Previous activation expired, start new 24h
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true, activatedAt: new Date() },
          include: { dni: true },
        })
      }
    } else {
      // First activation
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
