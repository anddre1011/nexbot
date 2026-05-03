'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

interface TodayStats {
  sales_today:          number
  revenue_today:        number
  conversations_today:  number
  messages_sent_today:  number
  conversion_rate:      string
}

interface Campaign {
  id:            string
  name:          string
  meta_ad_id:    string | null
  sales_count:   number
  total_revenue: number
}

interface Toast { id: string; message: string }

export default function DashboardPage() {
  const [stats,     setStats]     = useState<TodayStats | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [toasts,    setToasts]    = useState<Toast[]>([])

  const fetchData = useCallback(async () => {
    try {
      const [todayData, campaignData] = await Promise.all([
        apiFetch<TodayStats>('/api/analytics/today'),
        apiFetch<Campaign[]>('/api/analytics/campaigns'),
      ])
      setStats(todayData)
      setCampaigns(campaignData)
    } catch (err) { console.error('[dashboard]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('sales-confirmed')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: 'status=eq.confirmed' },
        (payload) => {
          const amount = (payload.new as { amount?: number }).amount
          addToast(`💰 Nueva venta — $${amount ?? '–'}`)
          fetchData()
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  function addToast(message: string) {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }

  const metricCards = [
    {
      label: 'Ventas hoy',
      value: loading ? '–' : String(stats?.sales_today ?? 0),
      sub:   loading ? '...' : `$${(stats?.revenue_today ?? 0).toFixed(2)} generados`,
      gradient: 'from-violet-600 to-purple-700',
      glow: 'rgba(124,58,237,0.3)',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Conversaciones',
      value: loading ? '–' : String(stats?.conversations_today ?? 0),
      sub:   'Iniciadas hoy',
      gradient: 'from-blue-600 to-cyan-600',
      glow: 'rgba(37,99,235,0.3)',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
    },
    {
      label: 'Mensajes enviados',
      value: loading ? '–' : String(stats?.messages_sent_today ?? 0),
      sub:   'Hoy',
      gradient: 'from-emerald-600 to-teal-600',
      glow: 'rgba(5,150,105,0.3)',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
    },
    {
      label: 'Conversiones',
      value: loading ? '–' : (stats?.conversion_rate ?? '0%'),
      sub:   'Mensajes → ventas',
      gradient: 'from-rose-600 to-pink-600',
      glow: 'rgba(225,29,72,0.3)',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ]

  return (
    <>
      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)', boxShadow: '0 8px 32px rgba(124,58,237,0.4)' }}
            className="flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold text-white">
            {t.message}
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} className="ml-2 opacity-70 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>

      <div className="p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">Actividad de hoy en tiempo real</p>
          </div>
          <button onClick={fetchData} disabled={loading}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-gray-400 transition-all hover:bg-white/10 disabled:opacity-40">
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>

        {/* Metric cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((card) => (
            <div key={card.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: `0 8px 32px ${card.glow}` }}
              className="relative overflow-hidden rounded-2xl p-6">
              {/* Gradient accent top */}
              <div style={{ background: `linear-gradient(135deg, var(--tw-gradient-from), var(--tw-gradient-to))` }}
                className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${card.gradient}`} />

              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">{card.label}</span>
                <div style={{ background: 'rgba(255,255,255,0.05)' }} className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} text-white`}>
                  {card.icon}
                </div>
              </div>

              <p className={`text-4xl font-extrabold text-white ${loading ? 'animate-pulse opacity-40' : ''}`}>
                {card.value}
              </p>
              <p className="mt-1.5 text-xs text-gray-500">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Campaigns table */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          className="rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-sm font-semibold text-white">Campañas Meta Ads</h2>
            {campaigns.length > 0 && (
              <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium text-violet-300">
                {campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-gray-600">Cargando...</div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <div style={{ background: 'rgba(255,255,255,0.03)' }} className="flex h-14 w-14 items-center justify-center rounded-2xl">
                <svg className="h-7 w-7 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">Sin campañas registradas aún</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  className="text-left text-xs font-semibold uppercase tracking-widest text-gray-600">
                  <th className="px-6 py-3">Campaña</th>
                  <th className="px-6 py-3">Meta Ad ID</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Total generado</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td className="px-6 py-3 font-medium text-gray-200">{c.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{c.meta_ad_id ?? '–'}</td>
                    <td className="px-6 py-3 text-right text-gray-300">{c.sales_count}</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-400">${c.total_revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                  <td colSpan={2} className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest">Total</td>
                  <td className="px-6 py-3 text-right font-bold text-gray-300">
                    {campaigns.reduce((s, c) => s + c.sales_count, 0)}
                  </td>
                  <td className="px-6 py-3 text-right font-extrabold text-emerald-400">
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
