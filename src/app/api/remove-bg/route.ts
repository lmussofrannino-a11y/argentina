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

    const apiKey = process.env.FAPIHUB_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key de FAPIhub no configurada' },
        { status: 500 }
      )
    }

    const mimeMatch = image.match(/^data:(image\/\w+);base64,/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const formData = new FormData()
    const blob = new Blob([buffer], { type: mime })
    const ext = mime === 'image/png' ? 'png' : 'jpg'
    formData.append('image', blob, `photo.${ext}`)

    const response = await fetch('https://fapihub.com/v2/rembg/', {
      method: 'POST',
      headers: {
        ApiKey: apiKey,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `FAPIhub API error ${response.status}: ${errorText}` },
        { status: response.status }
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    const resultBase64 = Buffer.from(arrayBuffer).toString('base64')
    const dataUrl = `data:image/png;base64,${resultBase64}`

    return NextResponse.json({ image: dataUrl }, { status: 200 })
  } catch (error) {
    console.error('Error en remove-bg API:', error)
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
