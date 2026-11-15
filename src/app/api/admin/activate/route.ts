import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { dniPublicSelect, withoutDniImages } from '@/lib/dni-response'
import { isAdminRequest } from '@/lib/auth'

const userPayloadSelect = {
  id: true,
  email: true,
  isActive: true,
  tokens: true,
  tokenDebt: true,
  activatedAt: true,
  dni: { select: dniPublicSelect },
} as const

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdminRequest(request))) {
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

    // If adding or removing tokens
    if (addTokens && typeof addTokens === 'number' && addTokens !== 0) {
      // Validate that we're not removing more tokens than available
      if (addTokens < 0 && Math.abs(addTokens) > existingUser.tokens) {
        return NextResponse.json(
          { error: 'No se pueden quitar más tokens de los que tiene el usuario' },
          { status: 400 }
        )
      }
      
      const debtPaid = addTokens > 0 ? Math.min(existingUser.tokenDebt, addTokens) : 0
      const tokenChange = addTokens > 0 ? addTokens - debtPaid : addTokens
      const newTokens = Math.max(0, existingUser.tokens + tokenChange)
      const updated = await db.user.update({
        where: { id: userId },
        data: { tokens: newTokens, tokenDebt: { decrement: debtPaid } },
        select: userPayloadSelect,
      })
      const action = addTokens > 0 ? 'agregaron' : 'quitaron'
      return NextResponse.json(
        {
          message: `Se ${action} ${Math.abs(addTokens)} token(s). Total: ${updated.tokens}`,
          appliedToDebt: debtPaid,
          user: withoutDniImages(updated),
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

    if (isActive && existingUser.tokenDebt > 0) {
      return NextResponse.json({ error: 'No se puede activar una cuenta con ajustes de tokens pendientes' }, { status: 409 })
    }

    let updatedUser

    if (!isActive) {
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { isActive: false, activatedAt: null },
        select: userPayloadSelect,
      })
    } else if (existingUser.activatedAt) {
      const hoursSinceActivation = (Date.now() - new Date(existingUser.activatedAt).getTime()) / (1000 * 60 * 60)
      if (hoursSinceActivation < 24) {
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true },
          select: userPayloadSelect,
        })
      } else {
        updatedUser = await db.user.update({
          where: { id: userId },
          data: { isActive: true, activatedAt: new Date() },
          select: userPayloadSelect,
        })
      }
    } else {
      updatedUser = await db.user.update({
        where: { id: userId },
        data: { isActive: true, activatedAt: new Date() },
        select: userPayloadSelect,
      })
    }

    return NextResponse.json(
      {
        message: isActive ? 'Cuenta activada exitosamente' : 'Cuenta desactivada',
        user: withoutDniImages(updatedUser),
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
