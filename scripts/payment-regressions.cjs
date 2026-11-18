// Deterministic regression tests of the production modules, using a Prisma-shaped
// in-memory adapter with per-user row locks. No credentials or network required.
// This exercises interleavings and rollback; it is not a PostgreSQL integration test.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const clone = (value) => structuredClone(value)

function matches(row, where = {}) {
  if (!row) return false
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((part) => matches(row, part))
    const actual = row[key]
    if (expected instanceof Date) return actual?.getTime() === expected.getTime()
    if (expected && typeof expected === 'object') {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === 'in') return value.includes(actual)
        if (operator === 'gt') return actual > value
        if (operator === 'gte') return actual >= value
        if (operator === 'lte') return actual <= value
        if (operator === 'lt') return actual < value
        if (operator === 'mode') return true
        if (operator === 'equals') return value instanceof Date ? actual?.getTime() === value.getTime() : expected.mode === 'insensitive' ? actual?.toLowerCase() === value.toLowerCase() : actual === value
        throw new Error(`Unsupported test operator ${operator}`)
      })
    }
    return actual === expected
  })
}

function fixture({ tokens = 0, tokenDebt = 0, isActive = false, activatedAt = null } = {}) {
  const tables = {
    user: new Map([['u', { id: 'u', email: 'user@example.test', isAdmin: false, tokens, tokenDebt, isActive, activatedAt }]]),
    paymentOrder: new Map(), processedPayment: new Map(),
    revokedSession: new Map(), paymentReconciliationIssue: new Map(), rateLimitBucket: new Map(),
  }
  const queues = new Map()
  let failNextBalanceWrite = false
  function delegate(name) {
    const rows = tables[name]
    return {
      async findUnique({ where }) { const result = clone([...rows.values()].find((row) => matches(row, where)) ?? null); await tick(); return result },
      async findFirst(args) { return this.findUnique(args) },
      async findMany({ where, orderBy = [], skip = 0, take = Infinity } = {}) {
        const order = Array.isArray(orderBy) ? orderBy : [orderBy]
        const result = clone([...rows.values()].filter((row) => matches(row, where)).sort((a, b) => {
          for (const part of order) for (const [key, direction] of Object.entries(part)) {
            if (a[key] === b[key]) continue
            return (a[key] > b[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1)
          }
          return 0
        }).slice(skip, skip + take))
        await tick(); return result
      },
      async findUniqueOrThrow(args) { const row = await this.findUnique(args); if (!row) throw new Error('Not found'); return row },
      async create({ data }) {
        if (rows.has(data.id)) throw new Error('Unique constraint')
        const row = { orderId: null, creditedQuantity: null, status: name === 'paymentOrder' ? 'pending' : 'approved', creationState: 'new', creationStartedAt: null, checkoutUrl: null, providerOrderId: null, preferenceId: null, createdAt: new Date(), isAdmin: false, ...clone(data) }
        rows.set(row.id, row); await tick(); return clone(row)
      },
      async updateMany({ where, data }) {
        let count = 0
        for (const row of rows.values()) {
          if (!matches(row, where)) continue
          for (const [key, change] of Object.entries(data)) {
            if (change && typeof change === 'object' && ('increment' in change || 'decrement' in change)) {
              row[key] += (change.increment ?? 0) - (change.decrement ?? 0)
            } else row[key] = clone(change)
          }
          count++
        }
        if (name === 'user' && failNextBalanceWrite && (data.tokens || data.tokenDebt)) {
          failNextBalanceWrite = false
          throw new Error('Injected balance failure')
        }
        await tick(); return { count }
      },
      async update({ where, data }) {
        const result = await this.updateMany({ where, data })
        if (!result.count) throw new Error('Not found')
        return clone([...rows.values()].find((row) => matches(row, where)))
      },
      async upsert({ where, create, update }) { return rows.has(where.id) ? this.update({ where, data: update }) : this.create({ data: create }) },
      async deleteMany({ where }) {
        let count = 0
        for (const [id, row] of rows) if (matches(row, where)) { rows.delete(id); count++ }
        return { count }
      },
    }
  }
  const db = Object.fromEntries(Object.keys(tables).map((name) => [name, delegate(name)]))
  db.$queryRaw = async (_strings, id, resetAt) => {
    let bucket = tables.rateLimitBucket.get(id)
    if (!bucket || bucket.resetAt <= new Date()) bucket = { id, count: 0, resetAt }
    bucket.count++
    tables.rateLimitBucket.set(id, bucket)
    return [{ count: bucket.count }]
  }
  db.$transaction = async (fn) => {
    let release
    let before = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, clone(table)]))
    const tx = { ...db, $queryRaw: async (_strings, userId) => {
      const previous = queues.get(userId) ?? Promise.resolve()
      const pending = new Promise((resolve) => { release = resolve })
      queues.set(userId, previous.then(() => pending))
      await previous
      before = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, clone(table)]))
      return [{ id: userId }]
    } }
    try { return await fn(tx) } catch (error) {
      if (before) for (const name of Object.keys(tables)) { tables[name].clear(); for (const [key, value] of before[name]) tables[name].set(key, value) }
      throw error
    } finally { release?.() }
  }
  const cache = new Map()
  const globals = {}
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative)
    const filename = path.join(root, relative)
    const source = process.env.PAYMENT_TEST_BASELINE
      ? execFileSync('git', ['show', `HEAD:${relative.replaceAll('\\', '/')}`], { cwd: root, encoding: 'utf8' })
      : readFileSync(filename, 'utf8')
    const module = { exports: {} }
    cache.set(relative, module.exports)
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const requireMock = (id) => {
      if (id === '@prisma/client') return { PrismaClient: class { constructor() { return db } } }
      if (id === '@/lib/auth') return { isAdminRequest: async () => true, getSessionUserId: async () => 'u', createSessionToken: () => 'unit-test-cookie', setSessionCookie: () => {} }
      if (id === '@/lib/r2-dni-images') return { isR2WriteEnabled: () => false }
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`)
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)).replaceAll('\\', '/'))
      return require(id)
    }
    new Function('require', 'module', 'exports', 'globalThis', compiled)(requireMock, module, module.exports, globals)
    cache.set(relative, module.exports)
    return module.exports
  }
  const payments = load('src/lib/payment-processing.ts')
  const orders = load('src/lib/checkout-order-processing.ts')
  const tokensLib = load('src/lib/tokens.ts')
  function addOrder(id, quantity = 1, provider = 'orders') {
    const row = { id, userId: 'u', packId: String(quantity), quantity, amount: quantity === 5 ? 12000 : 3000, currency: 'ARS', status: 'pending', preferenceId: provider === 'payments' ? `pref-${id}` : null, providerOrderId: provider === 'orders' ? `mp-${id}` : null, paymentId: null, createdAt: new Date(0) }
    tables.paymentOrder.set(id, row)
    return row
  }
  function remoteOrder(id, status = 'processed', status_detail = 'accredited') {
    const row = tables.paymentOrder.get(id)
    return { id: row.providerOrderId, external_reference: id, status, status_detail, total_amount: row.amount, currency: 'ARS' }
  }
  function remotePayment(id, status = 'approved', refunded = 0) {
    const row = tables.paymentOrder.get(id)
    return { id: `pay-${id}`, external_reference: id, preference_id: row.preferenceId, status, transaction_amount: row.amount, transaction_amount_refunded: refunded, currency_id: 'ARS' }
  }
  const legacy = (id = 'legacy', status = 'approved', refunded = 0) => ({ id, status, external_reference: 'u', metadata: { userId: 'u' }, transaction_amount: 3000, currency_id: 'ARS', transaction_amount_refunded: refunded })
  return { tables, payments, orders, tokensLib, load, addOrder, remoteOrder, remotePayment, legacy, failBalanceWrite: () => { failNextBalanceWrite = true }, user: () => tables.user.get('u') }
}

test('F01: simultaneous activations consume one token and preserve the window', async () => {
  const f = fixture({ tokens: 2 })
  await Promise.all([f.tokensLib.consumeTokenIfExpired('u'), f.tokensLib.consumeTokenIfExpired('u')])
  assert.equal(f.user().tokens, 1)
  assert.equal(f.user().isActive, true)
  const activation = f.user().activatedAt.getTime()
  await f.tokensLib.consumeTokenIfExpired('u')
  assert.equal(f.user().tokens, 1)
  assert.equal(f.user().activatedAt.getTime(), activation)
})

test('F01: simultaneous expiry/renewal consumes only one new token', async () => {
  const f = fixture({ tokens: 2, isActive: true, activatedAt: new Date(Date.now() - 25 * 3600000) })
  await Promise.all([f.tokensLib.consumeTokenIfExpired('u'), f.tokensLib.consumeTokenIfExpired('u')])
  assert.equal(f.user().tokens, 1)
  assert.equal(f.user().isActive, true)
  assert.ok(Date.now() - f.user().activatedAt.getTime() < 10000)
})

test('F01: debt prevents activation without consuming tokens', async () => {
  const f = fixture({ tokens: 2, tokenDebt: 1 })
  await f.tokensLib.consumeTokenIfExpired('u')
  assert.equal(f.user().tokens, 2)
  assert.equal(f.user().isActive, false)
})

test('F02: independent simultaneous purchases settle the same debt only once', async () => {
  const f = fixture({ tokenDebt: 1 })
  f.addOrder('a'); f.addOrder('b', 1, 'payments')
  await Promise.all([f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a')), f.payments.applyApprovedPayment(f.remotePayment('b'))])
  assert.deepEqual([f.user().tokens, f.user().tokenDebt], [1, 0])
})

test('F02: independent simultaneous reversals never overdraw the balance', async () => {
  const f = fixture()
  f.addOrder('a', 5); f.addOrder('b', 5, 'payments')
  await f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a'))
  await f.payments.applyApprovedPayment(f.remotePayment('b'))
  f.user().tokens = 5
  await Promise.all([f.orders.applyCheckoutOrderReversal(f.remoteOrder('a', 'refunded', 'refunded')), f.payments.applyPaymentReversal(f.remotePayment('b', 'refunded', 12000))])
  assert.deepEqual([f.user().tokens, f.user().tokenDebt], [0, 5])
})

test('F02: admin addition and purchase cannot both settle the same debt', async () => {
  const f = fixture({ tokenDebt: 1 })
  f.addOrder('a')
  const admin = f.load('src/app/api/admin/activate/route.ts')
  const response = await Promise.all([admin.POST({ json: async () => ({ userId: 'u', addTokens: 1 }) }), f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a'))])
  assert.equal(response[0].status, 200)
  assert.deepEqual([f.user().tokens, f.user().tokenDebt], [1, 0])
})

test('F03: historical partial review can become a full refund exactly once', async () => {
  const f = fixture({ tokens: 1 })
  f.tables.processedPayment.set('legacy', { id: 'legacy', userId: 'u', orderId: null, quantity: null, creditedQuantity: null, status: 'approved' })
  await f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'approved', 1000))
  await Promise.all([f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'refunded', 3000)), f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'refunded', 3000))])
  assert.deepEqual([f.user().tokens, f.user().tokenDebt], [0, 0])
  assert.equal(f.tables.processedPayment.get('legacy').status, 'refunded')
})

test('F03: chargeback takes priority over a residual partial-refund amount', async () => {
  const f = fixture()
  await f.payments.applyLegacyApprovedPayment(f.legacy(), 'u')
  await f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'charged_back', 1000))
  assert.equal(f.user().tokens, 0)
  assert.equal(f.tables.processedPayment.get('legacy').status, 'charged_back')
})

for (const kind of ['legacy', 'payments', 'orders']) {
  test(`F04/F05 ${kind}: partial refund before credit blocks stale approval and never removes unrelated tokens`, async () => {
    const f = fixture({ tokens: 4 })
    let partial, approve, definitive
    if (kind === 'legacy') {
      partial = () => f.payments.applyLegacyApprovedPayment(f.legacy('legacy', 'approved', 1000), 'u')
      approve = () => f.payments.applyLegacyApprovedPayment(f.legacy(), 'u')
      definitive = () => f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'refunded', 3000))
    } else if (kind === 'payments') {
      f.addOrder('a', 1, 'payments')
      partial = () => f.payments.applyApprovedPayment(f.remotePayment('a', 'approved', 1000))
      approve = () => f.payments.applyApprovedPayment(f.remotePayment('a'))
      definitive = () => f.payments.applyPaymentReversal(f.remotePayment('a', 'refunded', 3000))
    } else {
      f.addOrder('a')
      partial = () => f.orders.applyCheckoutOrderReversal(f.remoteOrder('a', 'processed', 'partially_refunded'))
      approve = () => f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a'))
      definitive = () => f.orders.applyCheckoutOrderReversal(f.remoteOrder('a', 'refunded', 'refunded'))
    }
    assert.equal((await partial()).success, false)
    assert.equal((await approve()).success, false)
    await definitive(); await approve()
    assert.deepEqual([f.user().tokens, f.user().tokenDebt], [4, 0])
  })
}

test('F05: full legacy refund before delayed approval persists a tombstone', async () => {
  const f = fixture({ tokens: 4 })
  await f.payments.applyLegacyPaymentReversal(f.legacy('legacy', 'refunded', 3000))
  assert.equal((await f.payments.applyLegacyApprovedPayment(f.legacy(), 'u')).success, false)
  assert.deepEqual([f.user().tokens, f.user().tokenDebt], [4, 0])
})

test('duplicate approval credits once and a failed transaction can be retried', async () => {
  const f = fixture()
  f.addOrder('a')
  f.failBalanceWrite()
  await assert.rejects(f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a')), /Injected/)
  assert.equal(f.tables.paymentOrder.get('a').status, 'pending')
  assert.equal(f.tables.processedPayment.size, 0)
  await Promise.all([f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a')), f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a'))])
  assert.equal(f.user().tokens, 1)
  assert.equal(f.tables.processedPayment.size, 1)
})

test('H01: missing payment.preference_id is resolved through a verified merchant order', async () => {
  const f = fixture()
  f.addOrder('a', 1, 'payments')
  const payment = { ...f.remotePayment('a'), preference_id: undefined, order: { id: 123 } }
  const previousFetch = global.fetch
  const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'unit-test-placeholder'
  global.fetch = async (url) => {
    assert.equal(url, 'https://api.mercadopago.com/merchant_orders/123')
    return Response.json({ id: 123, external_reference: 'a', preference_id: 'pref-a', payments: [{ id: 'pay-a' }] })
  }
  try {
    assert.equal((await f.payments.applyApprovedPayment(payment)).success, true)
    assert.equal(f.user().tokens, 1)
    await f.payments.applyPaymentReversal({ ...payment, status: 'refunded', transaction_amount_refunded: 3000 })
    assert.equal(f.user().tokens, 0)
  } finally {
    global.fetch = previousFetch
    if (previousToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN
    else process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken
  }
})

test('H01: merchant orders with wrong payment, reference or preference cannot authorize credit', async () => {
  const previousFetch = global.fetch
  const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'unit-test-placeholder'
  try {
    for (const override of [{ payments: [{ id: 'other' }] }, { external_reference: 'other' }, { preference_id: 'other' }, { id: 999 }]) {
      const f = fixture()
      f.addOrder('a', 1, 'payments')
      const payment = { ...f.remotePayment('a'), preference_id: undefined, order: { id: 123 } }
      global.fetch = async () => Response.json({ id: 123, external_reference: 'a', preference_id: 'pref-a', payments: [{ id: 'pay-a' }], ...override })
      assert.equal((await f.payments.applyApprovedPayment(payment)).success, false)
      assert.equal(f.user().tokens, 0)
    }
  } finally {
    global.fetch = previousFetch
    if (previousToken === undefined) delete process.env.MERCADO_PAGO_ACCESS_TOKEN
    else process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken
  }
})

for (const kind of ['orders', 'payments']) {
  test(`F03 ${kind}: review after credit remains reversible and late partial events cannot reopen a refund`, async () => {
    const f = fixture()
    f.addOrder('a', 5, kind)
    const approve = kind === 'orders' ? () => f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a')) : () => f.payments.applyApprovedPayment(f.remotePayment('a'))
    const partial = kind === 'orders' ? () => f.orders.applyCheckoutOrderReversal(f.remoteOrder('a', 'processed', 'partially_refunded')) : () => f.payments.applyPaymentReversal(f.remotePayment('a', 'approved', 1000))
    const reverse = kind === 'orders' ? () => f.orders.applyCheckoutOrderReversal(f.remoteOrder('a', 'charged_back', 'settled')) : () => f.payments.applyPaymentReversal(f.remotePayment('a', 'charged_back', 1000))
    await approve(); f.user().tokens = 2
    await partial(); await reverse(); await partial(); await reverse()
    assert.deepEqual([f.user().tokens, f.user().tokenDebt], [0, 3])
    assert.equal(f.tables.paymentOrder.get('a').status, 'charged_back')
  })
}

const { NextRequest } = require('next/server')
const { createHmac } = require('node:crypto')
function request(body, headers = {}) {
  return new NextRequest('https://example.test/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
function signedHeaders(id, secret, ts = String(Math.floor(Date.now() / 1000))) {
  const signature = createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:test-request;ts:${ts};`).digest('hex')
  return { 'x-request-id': 'test-request', 'x-signature': `ts=${ts},v1=${signature}` }
}
async function withRemote(fn) {
  const previousFetch = global.fetch
  const variables = ['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ORDERS_ACCESS_TOKEN', 'MERCADO_PAGO_ORDERS_WEBHOOK_SECRET']
  const previous = variables.map((name) => process.env[name])
  for (const name of variables) process.env[name] = 'unit-test-placeholder'
  try { await fn() } finally {
    global.fetch = previousFetch
    variables.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i] })
  }
}

test('F06: failed association is durable and retryable; repairing it recovers the webhook', () => withRemote(async () => {
  const f = fixture()
  const route = f.load('src/app/api/mercadopago/verify-payment/route.ts')
  global.fetch = async () => Response.json({ id: 'mp-a', external_reference: 'a', status: 'processed', status_detail: 'accredited', total_amount: 3000, currency: 'ARS' })
  const webhook = () => request({ type: 'order', data: { id: 'mp-a' } }, signedHeaders('mp-a', 'unit-test-placeholder'))
  assert.equal((await route.POST(webhook())).status, 503)
  assert.equal(f.tables.paymentReconciliationIssue.get('orders:mp-a').status, 'retry')
  f.addOrder('a')
  assert.equal((await route.POST(webhook())).status, 200)
  assert.equal(f.user().tokens, 1)
  assert.equal(f.tables.paymentReconciliationIssue.get('orders:mp-a').status, 'resolved')
}))

test('F08: newer unpaid checkout does not hide an older paid checkout', () => withRemote(async () => {
  const f = fixture()
  f.addOrder('a'); f.addOrder('b')
  global.fetch = async (url) => Response.json(url.endsWith('mp-b') ? f.remoteOrder('b', 'created', 'created') : f.remoteOrder('a'))
  const response = await f.load('src/app/api/mercadopago/verify-payment/route.ts').POST(request({}))
  assert.equal(response.status, 200)
  assert.equal(f.user().tokens, 1)
  assert.equal(f.tables.paymentOrder.get('a').status, 'paid')
}))

test('F08: paid local orders are reconsulted and reversed after a lost webhook', () => withRemote(async () => {
  const f = fixture()
  f.addOrder('a')
  await f.orders.applyApprovedCheckoutOrder(f.remoteOrder('a'))
  global.fetch = async () => Response.json(f.remoteOrder('a', 'refunded', 'refunded'))
  const response = await f.load('src/app/api/mercadopago/verify-payment/route.ts').POST(request({ orderId: 'a' }))
  assert.equal(response.status, 200)
  assert.equal(f.user().tokens, 0)
}))

test('F08: already-processed historical payment cannot hide the next uncredited payment', () => withRemote(async () => {
  const f = fixture()
  await f.payments.applyLegacyApprovedPayment(f.legacy('recent'), 'u')
  global.fetch = async (url) => {
    url = String(url)
    if (url.includes('/search?')) return Response.json({ results: [{ id: 'recent' }, { id: 'older' }] })
    return Response.json(f.legacy(url.endsWith('recent') ? 'recent' : 'older'))
  }
  assert.equal((await f.load('src/app/api/mercadopago/verify-payment/route.ts').POST(request({}))).status, 200)
  assert.equal(f.user().tokens, 2)
}))

test('F07: lost Orders response reuses the local order, provider key and original payload', () => withRemote(async () => {
  const f = fixture()
  const route = f.load('src/app/api/mercadopago/create-order/route.ts')
  const body = { pack: '1', attemptId: '12345678-1234-1234-1234-123456789abc' }
  const calls = []
  global.fetch = async (_url, options) => {
    calls.push({ key: options.headers['X-Idempotency-Key'], body: options.body })
    if (calls.length === 1) throw new Error('Response lost after remote creation')
    return Response.json({ id: 'mp-recovered', checkout_url: 'https://example.test/checkout' })
  }
  assert.equal((await route.POST(request(body))).status, 503)
  f.user().email = 'changed@example.test'
  assert.equal((await route.POST(request(body))).status, 200)
  assert.equal((await route.POST(request(body))).status, 200)
  assert.equal(f.tables.paymentOrder.size, 1)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
}))

test('F07: uncertain Preferences creation is recovered by search without a second POST', () => withRemote(async () => {
  const f = fixture()
  const route = f.load('src/app/api/mercadopago/create-preference/route.ts')
  const body = { pack: '1', attemptId: '12345678-1234-1234-1234-123456789abc' }
  let postCount = 0, orderId
  global.fetch = async (url, options) => {
    if (options.method === 'POST') { postCount++; orderId = JSON.parse(options.body).external_reference; throw new Error('Response lost') }
    if (url.includes('/search?')) return Response.json({ elements: [{ id: 'pref-recovered', external_reference: orderId }] })
    return Response.json({ id: 'pref-recovered', external_reference: orderId, init_point: 'https://example.test/checkout' })
  }
  assert.equal((await route.POST(request(body))).status, 503)
  assert.equal((await route.POST(request(body))).status, 200)
  assert.equal(f.tables.paymentOrder.size, 1)
  assert.equal(postCount, 1)
}))

test('F09: declaring the configured admin email does not grant an administrative role', async () => {
  const f = fixture()
  const auth = f.load('src/lib/auth.ts')
  const oldSecret = process.env.SESSION_SECRET, oldAdmin = process.env.ADMIN_EMAIL
  process.env.SESSION_SECRET = 'unit-test-session-secret-of-at-least-32-bytes'
  process.env.ADMIN_EMAIL = f.user().email
  try {
    const token = auth.createSessionToken('u')
    const req = request({}, { cookie: `miarg_session=${token}` })
    assert.equal(await auth.isAdminRequest(req), false)
    f.user().isAdmin = true
    assert.equal(await auth.isAdminRequest(req), true)
    const response = await f.load('src/app/api/auth/register/route.ts').POST(request({
      email: 'USER@EXAMPLE.TEST', password: 'password-example', nombre: 'A', apellido: 'B', dniNumero: '1', domicilio: 'Street', nacimiento: '2000-01-01', fechaEmision: '2020-01-01', sexo: 'X',
    }))
    assert.equal(response.status, 409)
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret
    if (oldAdmin === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = oldAdmin
  }
})

test('F10: logout revokes the copied cookie while another session remains valid', async () => {
  const f = fixture()
  const auth = f.load('src/lib/auth.ts')
  const previous = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'unit-test-session-secret-of-at-least-32-bytes'
  try {
    const a = auth.createSessionToken('u'), b = auth.createSessionToken('u')
    assert.notEqual(a, b)
    const reqA = request({}, { cookie: `miarg_session=${a}` }), reqB = request({}, { cookie: `miarg_session=${b}` })
    assert.equal(await auth.getSessionUserId(reqA), 'u')
    await auth.revokeSession(reqA)
    assert.equal(await auth.getSessionUserId(reqA), null)
    assert.equal(await auth.getSessionUserId(reqB), 'u')
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous }
})

test('F11: body limits work without Content-Length and rate limits reject excess attempts', async () => {
  const f = fixture()
  const limits = f.load('src/lib/request-limits.ts')
  await assert.rejects(limits.readLimitedJson(request({ value: 'x'.repeat(100) }), 32), { status: 413 })
  assert.deepEqual(await limits.readLimitedJson(request({ a: 1 }), 32), { a: 1 })
  await limits.enforceRateLimit('test', 'actor', 2, 60000)
  await limits.enforceRateLimit('test', 'actor', 2, 60000)
  await assert.rejects(limits.enforceRateLimit('test', 'actor', 2, 60000), { status: 429 })
})

test('F12: signed webhooks enforce timestamp bounds, unique keys and canonical hex', () => {
  const f = fixture()
  const valid = signedHeaders('123', 'test-secret')
  const check = (headers) => f.payments.isValidMercadoPagoWebhook(request({}, headers), '123', 'test-secret')
  assert.equal(check(valid), true)
  assert.equal(check(signedHeaders('123', 'test-secret', String(Date.now()))), true)
  assert.equal(check(signedHeaders('123', 'test-secret', String(Math.floor(Date.now() / 1000) - 8 * 86400))), false)
  assert.equal(check(signedHeaders('123', 'test-secret', String(Math.floor(Date.now() / 1000) + 600))), false)
  assert.equal(check({ ...valid, 'x-signature': `${valid['x-signature']},ts=123` }), false)
  assert.equal(check({ ...valid, 'x-signature': `${valid['x-signature']}00` }), false)
})

test('F06: partial reviews are durable and a late partial event cannot reopen a final reversal', () => withRemote(async () => {
  const f = fixture()
  f.addOrder('a')
  let remote = f.remoteOrder('a', 'processed', 'partially_refunded')
  global.fetch = async () => Response.json(remote)
  const route = f.load('src/app/api/mercadopago/verify-payment/route.ts')
  const webhook = () => request({ type: 'order', data: { id: 'mp-a' } }, signedHeaders('mp-a', 'unit-test-placeholder'))
  assert.equal((await route.POST(webhook())).status, 200)
  assert.equal(f.tables.paymentReconciliationIssue.get('orders:mp-a').status, 'review')
  remote = f.remoteOrder('a', 'refunded', 'refunded')
  await route.POST(webhook())
  remote = f.remoteOrder('a', 'processed', 'partially_refunded')
  await route.POST(webhook())
  assert.equal(f.tables.paymentReconciliationIssue.get('orders:mp-a').status, 'resolved')
  assert.equal(f.tables.paymentOrder.get('a').status, 'refunded')
  assert.equal(f.user().tokens, 0)
}))

test('F07: simultaneous requests for one attempt cannot create two remote checkouts', () => withRemote(async () => {
  const f = fixture()
  const route = f.load('src/app/api/mercadopago/create-order/route.ts')
  const body = { pack: '1', attemptId: '12345678-1234-1234-1234-123456789abc' }
  let start, release, calls = 0
  const started = new Promise((resolve) => { start = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  global.fetch = async () => { calls++; start(); await gate; return Response.json({ id: 'remote', checkout_url: 'https://example.test/checkout' }) }
  const first = route.POST(request(body))
  await started
  assert.equal((await route.POST(request(body))).status, 409)
  release()
  assert.equal((await first).status, 200)
  assert.equal(calls, 1)
  assert.equal(f.tables.paymentOrder.size, 1)
}))

test('F08: explicit order verification never reads or modifies another user order', async () => {
  const f = fixture()
  f.addOrder('other').userId = 'another-user'
  assert.equal((await f.load('src/app/api/mercadopago/verify-payment/route.ts').POST(request({ orderId: 'other' }))).status, 404)
  assert.equal(f.user().tokens, 0)
})

test('F09: a public registration cannot inject the administrative flag', async () => {
  const f = fixture()
  const response = await f.load('src/app/api/auth/register/route.ts').POST(request({
    email: 'new@example.test', password: 'password-example', nombre: 'A', apellido: 'B', dniNumero: '1', domicilio: 'Street', nacimiento: '2000-01-01', fechaEmision: '2020-01-01', sexo: 'X', isAdmin: true,
  }))
  assert.equal(response.status, 201)
  assert.equal([...f.tables.user.values()].find((user) => user.email === 'new@example.test').isAdmin, false)
})

test('F10: pre-upgrade cookies without a random session ID can also be revoked', async () => {
  const f = fixture()
  const auth = f.load('src/lib/auth.ts')
  const previous = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'unit-test-session-secret-of-at-least-32-bytes'
  try {
    const payload = Buffer.from(JSON.stringify({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 1000 })).toString('base64url')
    const signature = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url')
    const req = request({}, { cookie: `miarg_session=${payload}.${signature}` })
    assert.equal(await auth.getSessionUserId(req), 'u')
    await auth.revokeSession(req)
    assert.equal(await auth.getSessionUserId(req), null)
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous }
})

test('F07/F08: browser attempt IDs remain stable until resolved and preserve the target order', () => {
  const f = fixture()
  const attempts = f.load('src/lib/payment-attempt.ts')
  const first = attempts.getPurchaseAttempt('u', '1')
  assert.equal(attempts.getPurchaseAttempt('u', '1'), first)
  assert.notEqual(attempts.getPurchaseAttempt('u', '5'), first)
  attempts.rememberPaymentOrder('u', 'a')
  assert.equal(attempts.pendingPaymentOrder('u'), 'a')
  attempts.clearPendingPaymentOrder('u')
  attempts.clearPurchaseAttempts('u')
  assert.equal(attempts.pendingPaymentOrder('u'), null)
  assert.notEqual(attempts.getPurchaseAttempt('u', '1'), first)
})
