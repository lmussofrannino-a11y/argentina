import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

function generateTramiteNumero(): string {
  let result = ''
  for (let i = 0; i < 11; i++) {
    result += Math.floor(Math.random() * 10).toString()
  }
  return result
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      email,
      password,
      nombre,
      apellido,
      dniNumero,
      domicilio,
      nacimiento,
      fechaEmision,
      sexo,
      firma,
      foto,
      tramiteNumero: providedTramiteNumero,
    } = body

    const requiredFields = {
      email,
      password,
      nombre,
      apellido,
      dniNumero,
      domicilio,
      nacimiento,
      fechaEmision,
      sexo,
    }

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => !value || (typeof value === 'string' && value.trim() === ''))
      .map(([key]) => key)

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Campos requeridos faltantes: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Formato de email inválido' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 }
      )
    }

    const existingUser = await db.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Ya existe un usuario con ese email' },
        { status: 409 }
      )
    }

    const tramiteNumero = providedTramiteNumero || generateTramiteNumero()

    const user = await db.user.create({
      data: {
        email,
        password,
        dni: {
          create: {
            nombre,
            apellido,
            dniNumero,
            domicilio,
            nacimiento,
            fechaEmision,
            sexo,
            firma: firma || null,
            foto: foto || null,
            userId_value: dniNumero,
            tramiteNumero,
          },
        },
      },
      include: {
        dni: true,
      },
    })

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json(
      {
        message: 'Usuario registrado exitosamente',
        user: userWithoutPassword,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error en registro:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
