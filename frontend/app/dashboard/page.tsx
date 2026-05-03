'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface TodayStats {
  sales_today:         number
  revenue_today:       number
  conversations_today: number
  messages_sent_today: number
  conversion_rate:     string
}

interface Campaign {
  id:            string
  name:          string
  meta_ad_id:    string | null
  sales_count:   number
  total_revenue: number
}

interface Toast {
  id:      string
  message: string
}

// ─── componente ───────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats,     setStats]     = useState<TodayStats | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [toasts,    setToasts]    = useState<Toast[]>([])

  // ─── fetch analytics ────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [todayData, campaignData] = await Promise.all([
        apiFetch<TodayStats>('/api/analytics/today'),
        apiFetch<Campaign[]>('/api/analytics/campaigns'),
      ])
      setStats(todayData)
      setCampaigns(campaignData)
    } catch (err) {
      console.error('[dashboard] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── notificaciones push via Supabase Realtime ───────────────────────────────
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('sales-confirmed')
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'sales',
          filter: 'status=eq.confirmed',
        },
        (payload) => {
          const amount = (payload.new as { amount?: number }).amount
          addToast(`💰 Nueva venta — $${amount ?? '–'}`)
          // Refrescar stats para que las cards reflejen la nueva venta
          fetchData()
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  // ─── helper toast ────────────────────────────────────────────────────────────
  function addToast(message: string) {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }

  // ─── cards config ────────────────────────────────────────────────────────────
  const cards = [
    {
      label: 'Ventas hoy',
      value: loading ? '–' : String(stats?.sales_today ?? 0),
      sub:   loading ? '...' : `$${(stats?.revenue_today ?? 0).toFixed(2)} generados`,
      color: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Conversaciones',
      value: loading ? '–' : String(stats?.conversations_today ?? 0),
      sub:   'Iniciadas hoy',
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Mensajes enviados',
      value: loading ? '–' : String(stats?.messages_sent_today ?? 0),
      sub:   'Hoy',
      color: 'bg-sky-50 text-sky-600',
    },
    {
      label: 'Conversiones',
      value: loading ? '–' : (stats?.conversion_rate ?? '0%'),
      sub:   'Mensajes → ventas',
      color: 'bg-violet-50 text-violet-600',
    },
  ]

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── toasts ── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-lg"
          >
            {t.message}
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-auto text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">Actividad de hoy en tiempo real</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>

        {/* ── cards ── */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-2xl bg-white p-6 ring-1 ring-gray-200">
              <div className={`mb-3 inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${card.color}`}>
                {card.label}
              </div>
              <p className={`text-3xl font-bold text-gray-900 ${loading ? 'animate-pulse' : ''}`}>
                {card.value}
              </p>
              <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* ── tabla campañas ── */}
        <div className="mt-8 rounded-2xl bg-white ring-1 ring-gray-200">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">Campañas Meta Ads</h2>
            {campaigns.length > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400">
              Cargando...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400">
              Sin campañas registradas aún
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-gray-100 text-left text-xs font-medium text-gray-400">
                  <th className="px-6 py-3">Campaña</th>
                  <th className="px-6 py-3">Meta Ad ID</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Total generado</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`border-t border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}
                  >
                    <td className="px-6 py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-400">
                      {c.meta_ad_id ?? '–'}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">{c.sales_count}</td>
                    <td className="px-6 py-3 text-right font-semibold text-gray-900">
                      ${c.total_revenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td colSpan={2} className="px-6 py-3 text-xs font-medium text-gray-500">
                    Total
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-gray-700">
                    {campaigns.reduce((s, c) => s + c.sales_count, 0)}
                  </td>
                  <td className="px-6 py-3 text-right font-bold text-gray-900">
                    ${campaigns.reduce((s, c) => s + c.total_revenue, 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
