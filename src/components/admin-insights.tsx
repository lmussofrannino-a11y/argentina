'use client'

import { useEffect, useState } from 'react'
import './admin-insights.css'

type Overview = { total: number; active: number; withoutTokens: number; tokens: number; tokenDebt: number }
type Order = {
  id: string; packId: string; quantity: number; amount: number; currency: string;
  status: string; createdAt: string;
  user?: { id: string; email: string; dni: { nombre: string; apellido: string } | null };
}
type Detail = {
  user: {
    id: string; email: string; isActive: boolean; activatedAt: string | null;
    expiresAt: string | null; createdAt: string; tokens: number; tokenDebt: number;
    dni: { nombre: string; apellido: string; dniNumero: string } | null;
  };
  orders: Order[];
}
type OrderPage = { orders: Order[]; total: number; page: number; pageSize: number }

const statusLabels: Record<string, string> = {
  pending: 'Pendiente', paid: 'En proceso', approved: 'Aprobada',
  failed: 'Fallida', partial_refund_review: 'Revisar reembolso parcial',
}

const formattedDate = (value: string | null) => value
  ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  : '—'
const formattedAmount = (order: Order) => `${new Intl.NumberFormat('es-AR').format(order.amount)} ${order.currency}`

async function getAdminData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los datos')
  return data as T
}

function OrderRows({ orders, onSelectUser }: { orders: Order[]; onSelectUser?: (id: string) => void }) {
  return <ul className="admin-insights-orders-list">
    {orders.map(order => <li key={order.id}>
      <div className="admin-insights-order-top">
        <strong>{formattedAmount(order)}</strong>
        <span className="admin-insights-status">{statusLabels[order.status] ?? order.status}</span>
      </div>
      {order.user && <button type="button" className="admin-insights-user-link" onClick={() => onSelectUser?.(order.user!.id)}>
        {order.user.dni ? `${order.user.dni.apellido}, ${order.user.dni.nombre}` : order.user.email}
      </button>}
      <div className="admin-insights-meta">{formattedDate(order.createdAt)} · {order.quantity} token(s) · Paquete {order.packId}</div>
      <div className="admin-insights-id">Orden: {order.id}</div>
    </li>)}
  </ul>
}

export default function AdminInsights({ selectedUserId, onSelectUser, refreshKey }: {
  selectedUserId: string | null; onSelectUser: (id: string | null) => void; refreshKey: number;
}) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [orders, setOrders] = useState<OrderPage | null>(null)
  const [ordersError, setOrdersError] = useState('')
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const controller = new AbortController()
    getAdminData<Overview>('/api/admin/overview', controller.signal)
      .then(data => { setOverview(data); setOverviewError('') })
      .catch(error => { if (!controller.signal.aborted) setOverviewError(error.message) })
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    if (!selectedUserId) return
    const controller = new AbortController()
    setDetailLoading(true)
    setDetail(null)
    setDetailError('')
    getAdminData<Detail>(`/api/admin/users/${encodeURIComponent(selectedUserId)}`, controller.signal)
      .then(data => { setDetail(data); setDetailError(''); setDetailLoading(false) })
      .catch(error => { if (!controller.signal.aborted) { setDetailError(error.message); setDetailLoading(false) } })
    return () => controller.abort()
  }, [selectedUserId, refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ status, page: String(page) })
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    getAdminData<OrderPage>(`/api/admin/orders?${query}`, controller.signal)
      .then(data => { setOrders(data); setOrdersError(''); setOrdersLoading(false) })
      .catch(error => { if (!controller.signal.aborted) { setOrdersError(error.message); setOrdersLoading(false) } })
    return () => controller.abort()
  }, [status, from, to, page, refreshKey])

  const selectUser = (id: string | null) => {
    setDetail(null)
    setDetailError('')
    setDetailLoading(Boolean(id))
    onSelectUser(id)
  }

  return <div className="admin-insights">
    <section aria-labelledby="admin-overview-heading">
      <h2 id="admin-overview-heading">Resumen operativo</h2>
      {overviewError && <p role="alert" className="admin-insights-error">{overviewError}</p>}
      {!overview && !overviewError && <p>Cargando resumen…</p>}
      {overview && <div className="admin-insights-metrics">
        {[
          ['Usuarios registrados', overview.total],
          ['Documentos activos', overview.active],
          ['Usuarios sin tokens', overview.withoutTokens],
          ['Tokens disponibles', overview.tokens],
          ['Deuda de tokens', overview.tokenDebt],
        ].map(([label, value]) => <div key={label} className="admin-insights-metric">
          <span>{label}</span><strong>{new Intl.NumberFormat('es-AR').format(Number(value))}</strong>
        </div>)}
      </div>}
    </section>

    {selectedUserId && <section id="admin-user-detail" aria-labelledby="admin-user-heading" className="admin-insights-panel">
      <div className="admin-insights-heading"><h2 id="admin-user-heading">Ficha de usuario</h2><button type="button" onClick={() => selectUser(null)} aria-label="Cerrar ficha">Cerrar</button></div>
      {detailLoading && <p>Cargando ficha…</p>}
      {detailError && <p role="alert" className="admin-insights-error">{detailError}</p>}
      {detail?.user.id === selectedUserId && <>
        <strong>{detail.user.dni ? `${detail.user.dni.apellido}, ${detail.user.dni.nombre}` : detail.user.email}</strong>
        <dl className="admin-insights-detail-grid">
          {[
            ['Email', detail.user.email], ['DNI', detail.user.dni?.dniNumero ?? '—'],
            ['Estado del documento', detail.user.isActive ? 'Activo' : 'Inactivo'],
            ['Registrado', formattedDate(detail.user.createdAt)],
            ['Activado', formattedDate(detail.user.activatedAt)],
            ['Vence (estimado)', formattedDate(detail.user.expiresAt)],
            ['Tokens', String(detail.user.tokens)], ['Deuda de tokens', String(detail.user.tokenDebt)],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <h3>Últimas órdenes</h3>
        {detail.orders.length ? <OrderRows orders={detail.orders} /> : <p>Este usuario no tiene órdenes.</p>}
      </>}
    </section>}

    <section aria-labelledby="admin-orders-heading" className="admin-insights-panel">
      <h2 id="admin-orders-heading">Órdenes</h2>
      <div className="admin-insights-filters">
        <label>Estado
          <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); setOrdersLoading(true) }}>
            <option value="all">Todos</option><option value="pending">Pendientes</option>
            <option value="paid">En proceso</option><option value="approved">Aprobadas</option>
            <option value="failed">Fallidas</option><option value="partial_refund_review">Revisar reembolso parcial</option>
          </select>
        </label>
        <label>Desde (UTC)<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); setOrdersLoading(true) }} /></label>
        <label>Hasta (UTC)<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); setOrdersLoading(true) }} /></label>
      </div>
      {ordersLoading && <p>Cargando órdenes…</p>}
      {ordersError && <p role="alert" className="admin-insights-error">{ordersError}</p>}
      {!ordersLoading && !ordersError && orders && <>
        <p className="admin-insights-meta">{orders.total} orden(es) · página {orders.page} de {Math.max(1, Math.ceil(orders.total / orders.pageSize))}</p>
        {orders.orders.length ? <OrderRows orders={orders.orders} onSelectUser={selectUser} /> : <p>No hay órdenes con esos filtros.</p>}
        <div className="admin-insights-pagination">
          <button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); setOrdersLoading(true) }}>Anterior</button>
          <button type="button" disabled={page * orders.pageSize >= orders.total} onClick={() => { setPage(page + 1); setOrdersLoading(true) }}>Siguiente</button>
        </div>
      </>}
    </section>
  </div>
}
