import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { consumeTokenIfExpired } from '@/lib/tokens'
import { dniPublicSelect, withoutDniImages } from '@/lib/dni-response'
import { isR2WriteEnabled, uploadDniImage } from '@/lib/r2-dni-images'

async function prepareImageUpdate(
  value: unknown,
  userId: string,
  kind: 'foto' | 'firma'
): Promise<{ legacyValue: string | null; storageKey: string | null } | undefined> {
  if (value === undefined) return undefined
  if (value === null) return { legacyValue: null, storageKey: null }
  if (typeof value !== 'string') throw new Error(`El campo ${kind} no es válido`)

  if (isR2WriteEnabled()) {
    const upload = await uploadDniImage(userId, kind, value)
    return { legacyValue: null, storageKey: upload.key }
  }

  return { legacyValue: value, storageKey: null }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    if (!userId) {
      return NextResponse.json(
        { error: 'ID de usuario requerido' },
        { status: 400 }
      )
    }

    const body = await request.json()

    const {
      nombre, apellido, dniNumero, domicilio, nacimiento,
      fechaEmision, sexo, tramiteNumero, ejemplar, foto, firma,
    } = body

    const existingDni = await db.dniData.findUnique({
      where: { userId },
    })

    if (!existingDni) {
      return NextResponse.json(
        { error: 'Datos de DNI no encontrados para este usuario' },
        { status: 404 }
      )
    }

    const [fotoUpdate, firmaUpdate] = await Promise.all([
      prepareImageUpdate(foto, userId, 'foto'),
      prepareImageUpdate(firma, userId, 'firma'),
    ])

    const updatedDni = await db.dniData.update({
      where: { userId },
      data: {
        nombre: nombre ?? existingDni.nombre,
        apellido: apellido ?? existingDni.apellido,
        dniNumero: dniNumero ?? existingDni.dniNumero,
        domicilio: domicilio ?? existingDni.domicilio,
        nacimiento: nacimiento ?? existingDni.nacimiento,
        fechaEmision: fechaEmision ?? existingDni.fechaEmision,
        sexo: sexo ?? existingDni.sexo,
        tramiteNumero: tramiteNumero ?? existingDni.tramiteNumero,
        ejemplar: ejemplar ?? existingDni.ejemplar,
        foto: fotoUpdate ? fotoUpdate.legacyValue : existingDni.foto,
        firma: firmaUpdate ? firmaUpdate.legacyValue : existingDni.firma,
        fotoStorageKey: fotoUpdate ? fotoUpdate.storageKey : existingDni.fotoStorageKey,
        firmaStorageKey: firmaUpdate ? firmaUpdate.storageKey : existingDni.firmaStorageKey,
      },
    })

    return NextResponse.json(
      { message: 'Datos actualizados correctamente', dni: withoutDniImages({ dni: updatedDni }).dni },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error al actualizar datos de DNI:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    if (!userId) {
      return NextResponse.json(
        { error: 'ID de usuario requerido' },
        { status: 400 }
      )
    }

    // Only consume token when actively using the DNI
    const { isActive, tokensLeft } = await consumeTokenIfExpired(userId)

    if (!isActive) {
      return NextResponse.json(
        { error: 'Cuenta sin tokens disponibles', expired: true, tokens: tokensLeft },
        { status: 403 }
      )
    }

    const dniData = await db.dniData.findUnique({
      where: { userId },
      select: dniPublicSelect,
    })

    if (!dniData) {
      return NextResponse.json(
        { error: 'Datos de DNI no encontrados para este usuario' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { dni: withoutDniImages({ dni: dniData }).dni, tokens: tokensLeft },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error al obtener datos de DNI:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
