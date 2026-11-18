import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { dniPublicSelect, withoutDniImages } from '@/lib/dni-response'
import { isR2WriteEnabled, uploadDniImage } from '@/lib/r2-dni-images'
import { createSessionToken, setSessionCookie } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import { enforceRateLimit, readLimitedJson, RequestLimitError, requestActor } from '@/lib/request-limits'

function generateTramiteNumero(): string {
  let result = ''
  for (let i = 0; i < 11; i++) {
    result += Math.floor(Math.random() * 10).toString()
  }
  return result
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit('register:ip', requestActor(request), 5, 15 * 60 * 1000)
    const body = await readLimitedJson(request, 4 * 1024 * 1024)

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

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      password.length > 1024 ||
      typeof nombre !== 'string' ||
      typeof apellido !== 'string' ||
      typeof dniNumero !== 'string' ||
      typeof domicilio !== 'string' ||
      typeof nacimiento !== 'string' ||
      typeof fechaEmision !== 'string' ||
      typeof sexo !== 'string'
    ) {
      return NextResponse.json({ error: 'Los datos enviados no son válidos' }, { status: 400 })
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (normalizedEmail.length > 254 || normalizedEmail === process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
      return NextResponse.json({ error: 'Este email no está disponible para registro' }, { status: 409 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
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

    const existingUser = await db.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Ya existe un usuario con ese email' },
        { status: 409 }
      )
    }

    for (const value of [nombre, apellido, dniNumero, domicilio, nacimiento, fechaEmision, sexo, providedTramiteNumero]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 500)) {
        return NextResponse.json({ error: 'Uno de los campos es demasiado largo o no es válido' }, { status: 400 })
      }
    }
    const tramiteNumero = (typeof providedTramiteNumero === 'string' && providedTramiteNumero) || generateTramiteNumero()
    const userId = randomUUID()
    const sessionToken = createSessionToken(userId)
    const hashedPassword = await hashPassword(password)
    const useR2 = isR2WriteEnabled()
    const [fotoUpload, firmaUpload] = useR2
      ? await Promise.all([
          typeof foto === 'string' ? uploadDniImage(userId, 'foto', foto) : null,
          typeof firma === 'string' ? uploadDniImage(userId, 'firma', firma) : null,
        ])
      : [null, null]

    const user = await db.user.create({
      data: {
        id: userId,
        email: normalizedEmail,
        password: hashedPassword,
        dni: {
          create: {
            nombre,
            apellido,
            dniNumero,
            domicilio,
            nacimiento,
            fechaEmision,
            sexo,
            firma: useR2 ? null : (typeof firma === 'string' ? firma : null),
            foto: useR2 ? null : (typeof foto === 'string' ? foto : null),
            firmaStorageKey: firmaUpload?.key ?? null,
            fotoStorageKey: fotoUpload?.key ?? null,
            userId_value: dniNumero,
            tramiteNumero,
          },
        },
      },
      select: {
        id: true,
        email: true,
        isActive: true,
        tokens: true,
        tokenDebt: true,
        activatedAt: true,
        dni: { select: dniPublicSelect },
      },
    })

    const safeUser = withoutDniImages(user)

    const response = NextResponse.json(
      {
        message: 'Usuario registrado exitosamente',
        user: safeUser,
      },
      { status: 201 }
    )
    setSessionCookie(response, sessionToken)
    return response
  } catch (error) {
    if (error instanceof RequestLimitError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('Error en registro:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
