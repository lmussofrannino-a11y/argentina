const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')

function loadRoute(relative, db, admin) {
  const source = readFileSync(path.join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const requireMock = id => id === '@/lib/auth' ? { isAdminRequest: async () => admin }
    : id === '@/lib/db' ? { db } : require(id)
  new Function('require', 'module', 'exports', compiled)(requireMock, module, module.exports)
  return module.exports
}

const request = query => new NextRequest(`http://localhost/api/admin/orders${query}`)

test('admin endpoints refuse unauthenticated reads before querying data', async () => {
  const db = new Proxy({}, { get: () => { throw new Error('Database should not be read') } })
  for (const route of ['overview/route.ts', 'orders/route.ts', 'users/[id]/route.ts']) {
    const { GET } = loadRoute(`src/app/api/admin/${route}`, db, false)
    const response = await GET(request(''), { params: Promise.resolve({ id: 'u1' }) })
    assert.equal(response.status, 401)
  }
})

test('overview counts all users and aggregates balances without exposing user records', async () => {
  const db = { user: {
    count: async args => args?.where?.isActive ? 2 : args?.where?.tokens ? 1 : 3,
    aggregate: async () => ({ _sum: { tokens: 12, tokenDebt: 4 } }),
  } }
  const { GET } = loadRoute('src/app/api/admin/overview/route.ts', db, true)
  const response = await GET(request(''))
  assert.deepEqual(await response.json(), { total: 3, active: 2, withoutTokens: 1, tokens: 12, tokenDebt: 4 })
  assert.match(response.headers.get('Cache-Control'), /no-store/)
})

test('user detail returns expiry and five recent orders without private fields', async () => {
  let orderQuery
  const db = {
    user: { findUnique: async args => {
      assert.equal(args.where.id, 'u1')
      assert.equal(args.select.password, undefined)
      assert.deepEqual(Object.keys(args.select.dni.select).sort(), ['apellido', 'dniNumero', 'nombre'])
      return { id: 'u1', email: 'u@example.test', isActive: true, activatedAt: new Date('2026-11-26T12:00:00Z'), tokens: 1, tokenDebt: 0, dni: null }
    } },
    paymentOrder: { findMany: async args => { orderQuery = args; return [{ id: 'o1', status: 'approved' }] } },
  }
  const { GET } = loadRoute('src/app/api/admin/users/[id]/route.ts', db, true)
  const response = await GET(request(''), { params: Promise.resolve({ id: 'u1' }) })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.user.expiresAt, '2026-11-27T12:00:00.000Z')
  assert.equal(orderQuery.take, 5)
  assert.equal(orderQuery.select.creationPayload, undefined)
  assert.deepEqual(data.orders, [{ id: 'o1', status: 'approved' }])
})

test('orders filter inclusive UTC dates and paginate with bounded page size', async () => {
  let countWhere, orderQuery
  const db = { paymentOrder: {
    count: async args => { countWhere = args.where; return 25 },
    findMany: async args => { orderQuery = args; return [{ id: 'o2', status: 'failed' }] },
  } }
  const { GET } = loadRoute('src/app/api/admin/orders/route.ts', db, true)
  const response = await GET(request('?status=failed&from=2026-11-01&to=2026-11-27&page=2'))
  assert.equal(response.status, 200)
  assert.deepEqual(countWhere, orderQuery.where)
  assert.equal(orderQuery.where.status, 'failed')
  assert.equal(orderQuery.where.createdAt.gte.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(orderQuery.where.createdAt.lte.toISOString(), '2026-11-27T23:59:59.999Z')
  assert.equal(orderQuery.skip, 20)
  assert.equal(orderQuery.take, 20)
  assert.equal(orderQuery.select.creationPayload, undefined)
  assert.deepEqual(await response.json(), { orders: [{ id: 'o2', status: 'failed' }], total: 25, page: 2, pageSize: 20 })

  for (const query of ['?status=oops', '?page=0', '?page=10000', '?from=2026-02-30', '?from=2026-11-28&to=2026-11-27']) {
    assert.equal((await GET(request(query))).status, 400)
  }
})
