import { NextRequest, NextResponse } from 'next/server'
import { rembg } from '@remove-background-ai/rembg.js'

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json()

    if (!image) {
      return NextResponse.json(
        { error: 'No se proporcionó ninguna imagen' },
        { status: 400 }
      )
    }

    const apiKey = process.env.REMBG_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key de rembg no configurada' },
        { status: 500 }
      )
    }

    const { base64Image } = await rembg({
      apiKey,
      inputImage: { base64: image },
      onUploadProgress: console.log,
      onDownloadProgress: console.log,
      options: {
        format: 'png',
        returnBase64: true,
      },
    })

    const dataUrl = `data:image/png;base64,${base64Image}`

    return NextResponse.json({ image: dataUrl }, { status: 200 })
  } catch (error) {
    console.error('Error en remove-bg API:', error)
    const message =
      error instanceof Error ? error.message : 'Error interno del servidor'
    const stack = error instanceof Error ? error.stack : ''
    return NextResponse.json(
      { error: message, stack },
      { status: 500 }
    )
  }
}
