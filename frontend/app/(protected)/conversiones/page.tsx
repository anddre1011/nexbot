'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

type ConversionStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'retrying' | 'no_attribution'

interface ConversionRow {
  id: string
  event_name: string
  status: ConversionStatus
  value: number
  currency: string
  attempts: number
  event_id: string
  ctwa_clid: string | null
  product_names: string[] | null
  order_id: string | null
  created_at: string
  sent_at: string | null
  meta_fbtrace_id: string | null
  contacts?: { name: string | null; phone: string | null } | null
}

interface ConversionResponse {
  data: ConversionRow[]
  page: number
  limit: number
  total: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Fallido',
  retrying: 'Reintentando',
  no_attribution: 'Sin CTWA',
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
  sending: 'border-blue-400/25 bg-blue-500/10 text-blue-200',
  sent: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
  failed: 'border-red-400/25 bg-red-500/10 text-red-200',
  retrying: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
  no_attribution: 'border-gray-400/20 bg-white/5 text-gray-300',
}

function toIsoStart(date: string) {
  return date ? new Date(`${date}T00:00:00`).toISOString() : ''
}

function toIsoEnd(date: string) {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : ''
}

export default function ConversionesPage() {
  const [rows, setRows] = useState<ConversionRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '50')
    if (status) params.set('status', status)
    if (fromDate) params.set('from', toIsoStart(fromDate))
    if (toDate) params.set('to', toIsoEnd(toDate))
    return params.toString()
  }, [fromDate, page, status, toDate])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch<ConversionResponse>(`/api/conversions?${query}`)
      setRows(res.data ?? [])
      setTotal(res.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las conversiones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [query])

  async function retry(id: string) {
    setRetryingId(id)
    setError('')
    try {
      await apiFetch<{ ok: boolean }>(`/api/conversions/${id}/retry`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reintentar')
    } finally {
      setRetryingId(null)
    }
  }

  const sent = rows.filter((row) => row.status === 'sent').length
  const failed = rows.filter((row) => row.status === 'failed').length
  const pending = rows.filter((row) => row.status === 'pending' || row.status === 'retrying').length
  const revenue = rows.filter((row) => row.status === 'sent').reduce((sum, row) => sum + Number(row.value ?? 0), 0)
  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="min-h-screen bg-[#080811] p-4 text-white sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300">Meta CAPI</p>
          <h1 className="mt-1 text-2xl font-black">Conversiones</h1>
          <p className="mt-1 text-sm text-gray-500">Audita las compras enviadas a Meta y reintenta fallos sin tocar las ventas.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-gray-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Enviadas" value={sent} sub="Meta recibió estos eventos" tone="emerald" />
        <Metric label="Valor enviado" value={`BOB ${revenue.toFixed(2)}`} sub="Solo eventos enviados" tone="amber" />
        <Metric label="Pendientes" value={pending} sub="En cola o reintento" tone="violet" />
        <Metric label="Fallidas" value={failed} sub="Revisar token o dataset" tone="red" />
      </div>

      <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="h-10 rounded-xl border border-white/10 bg-[#141421] px-3 text-sm text-gray-200 outline-none focus:border-violet-400"
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1) }}
            className="h-10 rounded-xl border border-white/10 bg-[#141421] px-3 text-sm text-gray-200 outline-none focus:border-violet-400"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1) }}
            className="h-10 rounded-xl border border-white/10 bg-[#141421] px-3 text-sm text-gray-200 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => { setStatus(''); setFromDate(''); setToDate(''); setPage(1) }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-gray-300 hover:text-white"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-white/[0.03] text-left text-[10px] font-bold uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">CTWA</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-gray-600">Cargando conversiones...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-gray-600">Sin conversiones registradas todavía.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="border-t border-white/[0.05]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-200">{row.contacts?.name || row.contacts?.phone || 'Sin nombre'}</div>
                    <div className="text-xs text-gray-600">{row.contacts?.phone ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{row.product_names?.join(', ') || '-'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-violet-200">{row.event_name}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-300">{row.currency} {Number(row.value ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.ctwa_clid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-gray-500'}`}>
                      {row.ctwa_clid ? 'Con click' : 'Sin click'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_CLASS[row.status] ?? STATUS_CLASS.pending}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(row.created_at).toLocaleString('es-BO')}</td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'failed' ? (
                      <button
                        onClick={() => retry(row.id)}
                        disabled={retryingId === row.id}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        {retryingId === row.id ? 'Reintentando...' : 'Reintentar'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-600">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-gray-500">
          <span>{total} eventos</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-bold text-gray-300 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>Página {page} de {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-bold text-gray-300 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: number | string; sub: string; tone: 'emerald' | 'amber' | 'violet' | 'red' }) {
  const cls = {
    emerald: 'border-emerald-400/15 shadow-[0_0_24px_rgba(16,185,129,0.08)]',
    amber: 'border-amber-400/15 shadow-[0_0_24px_rgba(245,158,11,0.08)]',
    violet: 'border-violet-400/15 shadow-[0_0_24px_rgba(124,58,237,0.10)]',
    red: 'border-red-400/15 shadow-[0_0_24px_rgba(239,68,68,0.08)]',
  }[tone]

  return (
    <div className={`rounded-2xl border bg-white/[0.03] p-4 ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-white">{value}</p>
      <p className="mt-1 text-[10px] text-gray-600">{sub}</p>
    </div>
  )
}
