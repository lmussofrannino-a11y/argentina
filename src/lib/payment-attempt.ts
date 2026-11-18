// Browser-only helpers called by the client page. Memory fallback keeps retries
// stable within the current tab even when sessionStorage is unavailable.
const memory = new Map<string, string>()
function read(key: string) {
  try { return sessionStorage.getItem(key) ?? memory.get(key) ?? null } catch { return memory.get(key) ?? null }
}
function write(key: string, value: string | null) {
  if (value === null) memory.delete(key)
  else memory.set(key, value)
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value) } catch { /* memory fallback */ }
}
export function getPurchaseAttempt(userId: string, pack: string): string {
  const key = `miarg-checkout:${userId}:${pack}`
  const existing = read(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  write(key, id)
  return id
}
export function clearPurchaseAttempts(userId: string) {
  for (const pack of ['1', '5']) write(`miarg-checkout:${userId}:${pack}`, null)
}
export function rememberPaymentOrder(userId: string, orderId: string) { write(`miarg-order:${userId}`, orderId) }
export function pendingPaymentOrder(userId: string) { return read(`miarg-order:${userId}`) }
export function clearPendingPaymentOrder(userId: string) { write(`miarg-order:${userId}`, null) }
