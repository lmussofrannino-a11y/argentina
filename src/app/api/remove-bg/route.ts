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

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const formData = new FormData()
    const blob = new Blob([buffer], { type: 'image/png' })
    formData.append('image', blob, 'photo.png')
    formData.append('format', 'png')

    const response = await fetch('https://api.rembg.com/rmbg', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
      },
      body: formData,
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
    const mimeType = response.headers.get('content-type') || 'image/png'
    const dataUrl = `data:${mimeType};base64,${resultBase64}`

    return NextResponse.json({ image: dataUrl }, { status: 200 })
  } catch (error) {
    console.error('Error en remove-bg API:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
