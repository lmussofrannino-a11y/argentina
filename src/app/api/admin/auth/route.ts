import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/auth'

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  return NextResponse.json({ authorized: true }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
