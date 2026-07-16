import { NextRequest, NextResponse } from 'next/server'

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

    let base64Data = image
    if (base64Data.startsWith('data:')) {
      base64Data = base64Data.split(',')[1]
    }
    const buffer = Buffer.from(base64Data, 'base64')

    const FormData = (await import('form-data')).default
    const form = new FormData()
    form.append('image', buffer, { filename: 'photo.png', contentType: 'image/png' })
    form.append('format', 'png')

    const response = await fetch('https://api.rembg.com/rmbg', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        ...form.getHeaders(),
      },
      body: form,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `rembg API error ${response.status}: ${errorText}` },
        { status: response.status }
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    const resultBase64 = Buffer.from(arrayBuffer).toString('base64')
    const dataUrl = `data:image/png;base64,${resultBase64}`

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
