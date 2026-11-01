import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createDniImageUrl } from '@/lib/r2-dni-images'

async function resolveImageUrl(storageKey: string | null, legacyDataUrl: string | null) {
  if (!storageKey) return legacyDataUrl
  try {
    return await createDniImageUrl(storageKey)
  } catch (error) {
    // During rollout, keep using the preserved Base64 copy if R2 is temporarily unavailable.
    if (legacyDataUrl) return legacyDataUrl
    throw error
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
    if (!userId) {
      return NextResponse.json({ error: 'ID de usuario requerido' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isActive: true, activatedAt: true },
    })
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    if (
      !user.isActive ||
      (user.activatedAt && Date.now() >= user.activatedAt.getTime() + 24 * 60 * 60 * 1000)
    ) {
      return NextResponse.json(
        { error: 'Necesitás un token activo para acceder a las imágenes del DNI' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      )
    }

    const dni = await db.dniData.findUnique({
      where: { userId },
      select: {
        foto: true,
        firma: true,
        fotoStorageKey: true,
        firmaStorageKey: true,
      },
    })

    if (!dni) {
      return NextResponse.json({ error: 'Datos de DNI no encontrados' }, { status: 404 })
    }

    const [fotoUrl, firmaUrl] = await Promise.all([
      resolveImageUrl(dni.fotoStorageKey, dni.foto),
      resolveImageUrl(dni.firmaStorageKey, dni.firma),
    ])

    return NextResponse.json(
      {
        fotoUrl,
        firmaUrl,
        refreshAfterMs: dni.fotoStorageKey || dni.firmaStorageKey ? 5 * 60 * 1000 : null,
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    )
  } catch (error) {
    console.error('Error al obtener imágenes privadas del DNI:', error)
    return NextResponse.json({ error: 'No se pudieron cargar las imágenes del DNI' }, { status: 503 })
  }
}
