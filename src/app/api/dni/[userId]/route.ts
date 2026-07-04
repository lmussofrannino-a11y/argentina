import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { consumeTokenIfExpired } from '@/lib/tokens'

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
        foto: foto !== undefined ? foto : existingDni.foto,
        firma: firma !== undefined ? firma : existingDni.firma,
      },
    })

    return NextResponse.json(
      { message: 'Datos actualizados correctamente', dni: updatedDni },
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

    const { isActive, tokensLeft } = await consumeTokenIfExpired(userId)

    if (!isActive) {
      return NextResponse.json(
        { error: 'Cuenta sin tokens disponibles', expired: true, tokens: tokensLeft },
        { status: 403 }
      )
    }

    const dniData = await db.dniData.findUnique({
      where: { userId },
    })

    if (!dniData) {
      return NextResponse.json(
        { error: 'Datos de DNI no encontrados para este usuario' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { dni: dniData, tokens: tokensLeft },
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
