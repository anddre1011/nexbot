'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Sale {
  id:         string
  product:    string
  amount:     number
  status:     'pending' | 'confirmed' | 'rejected'
  created_at: string
  contact_id: string
  contacts?:  { name: string | null; phone: string } | null
  campaigns?: { name: string } | null
}

const STATUS_CONFIG = {
  confirmed: { label: 'Confirmada', color: 'text-emerald-400', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)' },
  pending:   { label: 'Pendiente',  color: 'text-amber-400',   bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  rejected:  { label: 'Rechazada', color: 'text-red-400',     bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)' },
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SalesPage() {
  const [sales,   setSales]   = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try { setSales(await apiFetch<Sale[]>('/api/sales')) }
    catch (err) { console.error('[sales]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSales() }, [fetchSales])

  async function updateStatus(id: string, status: 'confirmed' | 'rejected') {
    setUpdating(id)
    setSales((prev) => prev.map((s) => s.id === id ? { ...s, status } : s))
    try {
      await apiFetch(`/api/sales/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    } catch { fetchSales() }
    finally { setUpdating(null) }
  }

  // Métricas
  const confirmed   = sales.filter((s) => s.status === 'confirmed')
  const pending     = sales.filter((s) => s.status === 'pending')
  const totalRev    = confirmed.reduce((s, v) => s + v.amount, 0)

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0a0a0f] text-gray-100">

      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#0d0d14' }}
        className="shrink-0 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Ventas</h1>
            <p className="text-sm text-gray-500 mt-0.5">Comprobantes y registro de pagos</p>
          </div>
          <button onClick={fetchSales} disabled={loading}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-gray-400 hover:bg-white/10 transition-all disabled:opacity-40">
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>

        {/* Métricas */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Total confirmadas', value: loading ? '–' : String(confirmed.length), gradient: 'rgba(16,185,129,0.3)', color: 'text-emerald-400' },
            { label: 'Ingresos totales',  value: loading ? '–' : `$${totalRev.toFixed(2)}`, gradient: 'rgba(124,58,237,0.3)', color: 'text-violet-400' },
            { label: 'Pendientes',        value: loading ? '–' : String(pending.length), gradient: 'rgba(245,158,11,0.3)', color: 'text-amber-400' },
          ].map(({ label, value, gradient, color }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: `0 4px 20px ${gradient}` }}
              className="rounded-xl px-4 py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`mt-1 text-2xl font-extrabold ${loading ? 'animate-pulse text-gray-700' : color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead style={{ background: '#0d0d14' }}
            className="sticky top-0 text-left text-xs font-semibold uppercase tracking-widest text-gray-600">
            <tr>
              <th className="px-6 py-3">Contacto</th>
              <th className="px-6 py-3">Producto</th>
              <th className="px-6 py-3">Campaña</th>
              <th className="px-6 py-3 text-right">Monto</th>
              <th className="px-6 py-3">Fecha</th>
              <th className="px-6 py-3 text-center">Estado</th>
              <th className="px-6 py-3 w-28" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="py-20 text-center text-sm text-gray-600">Cargando ventas...</td></tr>
            )}
            {!loading && sales.length === 0 && (
              <tr><td colSpan={7} className="py-20 text-center text-sm text-gray-600">Sin ventas registradas</td></tr>
            )}
            {sales.map((sale) => {
              const cfg = STATUS_CONFIG[sale.status]
              return (
                <tr key={sale.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  className="transition-colors hover:bg-white/[0.02]">

                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-200">{sale.contacts?.name ?? 'Sin nombre'}</p>
                    <p className="font-mono text-xs text-gray-500">{sale.contacts?.phone ?? '–'}</p>
                  </td>

                  <td className="px-6 py-3 text-gray-300">{sale.product}</td>

                  <td className="px-6 py-3 text-xs text-violet-300">
                    {sale.campaigns?.name ?? <span className="text-gray-600">–</span>}
                  </td>

                  <td className="px-6 py-3 text-right font-bold text-emerald-400">
                    ${sale.amount.toFixed(2)}
                  </td>

                  <td className="px-6 py-3 text-xs text-gray-500">{fmtDate(sale.created_at)}</td>

                  <td className="px-6 py-3 text-center">
                    <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </td>

                  <td className="px-6 py-3">
                    {sale.status === 'pending' && (
                      <div className="flex gap-1.5">
                        <button onClick={() => updateStatus(sale.id, 'confirmed')}
                          disabled={updating === sale.id}
                          style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}
                          className="rounded-lg px-2.5 py-1 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40">
                          ✓ Confirmar
                        </button>
                        <button onClick={() => updateStatus(sale.id, 'rejected')}
                          disabled={updating === sale.id}
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                          className="rounded-lg px-2.5 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40">
                          ✕
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
