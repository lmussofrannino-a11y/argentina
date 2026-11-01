import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const TOKEN_DURATION_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const { userId, activatedAt } = await req.json()

    if (typeof userId !== 'string' || typeof activatedAt !== 'string') {
      return NextResponse.json(
        { error: 'userId y activatedAt son requeridos' },
        { status: 400 }
      )
    }

    const expectedActivation = new Date(activatedAt)
    if (Number.isNaN(expectedActivation.getTime())) {
      return NextResponse.json({ error: 'activatedAt no es válido' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isActive: true, activatedAt: true, tokens: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (!user.isActive || !user.activatedAt) {
      return NextResponse.json({
        success: true,
        expired: false,
        isActive: false,
        activatedAt: null,
        tokensLeft: user.tokens,
      })
    }

    // Ignore an expiry request from an older activation if another token was activated meanwhile.
    if (user.activatedAt.getTime() !== expectedActivation.getTime()) {
      return NextResponse.json({
        success: false,
        isActive: true,
        activatedAt: user.activatedAt,
        tokensLeft: user.tokens,
      }, { status: 409 })
    }

    const now = Date.now()
    const expiresAt = user.activatedAt.getTime() + TOKEN_DURATION_MS
    if (now < expiresAt) {
      return NextResponse.json({
        success: false,
        isActive: true,
        activatedAt: user.activatedAt,
        tokensLeft: user.tokens,
        expiresAt: new Date(expiresAt),
      }, { status: 409 })
    }

    // The token was already deducted when activated. Expiry only closes the session.
    // Match the activation timestamp atomically so this cannot deactivate a newer token.
    await db.user.updateMany({
      where: {
        id: userId,
        isActive: true,
        activatedAt: {
          equals: user.activatedAt,
          lte: new Date(now - TOKEN_DURATION_MS),
        },
      },
      data: {
        isActive: false,
        activatedAt: null,
      },
    })

    const latestUser = await db.user.findUnique({
      where: { id: userId },
      select: { isActive: true, activatedAt: true, tokens: true },
    })

    return NextResponse.json({
      success: true,
      expired: !latestUser?.isActive,
      isActive: latestUser?.isActive ?? false,
      activatedAt: latestUser?.activatedAt ?? null,
      tokensLeft: latestUser?.tokens ?? 0,
    })
  } catch (error) {
    console.error('Error expiring token:', error)
    return NextResponse.json(
      { error: 'Error al desactivar el documento vencido' },
      { status: 500 }
    )
  }
}
