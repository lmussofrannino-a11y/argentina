import { NextRequest } from 'next/server'
import { createCheckout } from '@/lib/checkout-creation'

export async function POST(request: NextRequest) {
  return createCheckout(request, 'preferences')
}
