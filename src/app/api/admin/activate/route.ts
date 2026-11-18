import { db, lockUserForTokenUpdate } from '@/lib/db'
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
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { userId, isActive, addTokens } = await request.json()
    if (typeof userId !== 'string' || !userId || (addTokens !== undefined && (!Number.isSafeInteger(addTokens) || Math.abs(addTokens) > 1000000))) {
      return NextResponse.json({ error: 'Los datos enviados no son válidos' }, { status: 400 })
    }

    return await db.$transaction(async (transaction) => {
      await lockUserForTokenUpdate(transaction, userId)
      const existingUser = await transaction.user.findUnique({ where: { id: userId } })
      if (!existingUser) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
      }

      if (typeof addTokens === 'number' && addTokens !== 0) {
        if (addTokens < 0 && Math.abs(addTokens) > existingUser.tokens) {
          return NextResponse.json({ error: 'No se pueden quitar más tokens de los que tiene el usuario' }, { status: 400 })
        }

        const debtPaid = addTokens > 0 ? Math.min(existingUser.tokenDebt, addTokens) : 0
        const tokenChange = addTokens > 0 ? addTokens - debtPaid : addTokens
        const updated = await transaction.user.update({
          where: { id: userId },
          data: { tokens: { increment: tokenChange }, tokenDebt: { decrement: debtPaid } },
          select: userPayloadSelect,
        })
        const action = addTokens > 0 ? 'agregaron' : 'quitaron'
        return NextResponse.json({
          message: `Se ${action} ${Math.abs(addTokens)} token(s). Total: ${updated.tokens}`,
          appliedToDebt: debtPaid,
          user: withoutDniImages(updated),
        })
      }

      // Preserve the legacy admin activation toggle without consuming a token.
      if (typeof isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive (boolean) o addTokens (number) son requeridos' }, { status: 400 })
      }
      if (isActive && existingUser.tokenDebt > 0) {
        return NextResponse.json({ error: 'No se puede activar una cuenta con ajustes de tokens pendientes' }, { status: 409 })
      }

      const keepActivation = existingUser.activatedAt && Date.now() - existingUser.activatedAt.getTime() < 24 * 60 * 60 * 1000
      const updated = await transaction.user.update({
        where: { id: userId },
        data: { isActive, activatedAt: isActive ? (keepActivation ? existingUser.activatedAt : new Date()) : null },
        select: userPayloadSelect,
      })
      return NextResponse.json({
        message: isActive ? 'Cuenta activada exitosamente' : 'Cuenta desactivada',
        user: withoutDniImages(updated),
      })
    })
  } catch (error) {
    console.error('Error al activar usuario:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
