export const PAYMENT_PACKS = {
  '1': { id: '1', quantity: 1, amount: 3000, title: '1 Token miArgentina' },
  '5': { id: '5', quantity: 5, amount: 12000, title: '5 Tokens miArgentina' },
} as const

export type PaymentPackId = keyof typeof PAYMENT_PACKS

export function getPaymentPack(value: unknown) {
  if (value === '1' || value === '5') return PAYMENT_PACKS[value]
  return null
}
