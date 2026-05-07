'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'

interface Overview {
  conversations_total: number; ia_attending: number; conversion_rate: string
  product_value: number; sales_count: number; clients: number; total_executions: number
}
interface Campaign { id: string; name: string; meta_ad_id: string | null; sales_count: number; total_revenue: number }
interface LeadByCampaign { name: string; leads: number; conversions: number; rate: string; revenue: number }
interface TopProduct { name: string; count: number; revenue: number }
interface ContactEvolution { date: string; count: number }
interface Toast { id: string; message: string }

const KANBAN_COLORS: Record<string, string> = {
  bot: '#3b82f6', open: '#3b82f6', human: '#a855f7', closed: '#f97316',
  converted: '#10b981', disqualified: '#ef4444', abandoned: '#f87171',
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [leadsByCampaign, setLeadsByCampaign] = useState<LeadByCampaign[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [contactsEvo, setContactsEvo] = useState<ContactEvolution[]>([])
  const [kanbanDist, setKanbanDist] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])

  const fetchData = useCallback(async () => {
    try {
      const [ov, camp, leads, prods, evo, kanban] = await Promise.all([
        apiFetch<Overview>('/api/analytics/overview'),
        apiFetch<Campaign[]>('/api/analytics/campaigns'),
        apiFetch<LeadByCampaign[]>('/api/analytics/leads-by-campaign').catch(() => []),
        apiFetch<TopProduct[]>('/api/analytics/top-products').catch(() => []),
        apiFetch<ContactEvolution[]>('/api/analytics/contacts-evolution').catch(() => []),
        apiFetch<Record<string, number>>('/api/analytics/kanban-distribution').catch(() => ({})),
      ])
      setOverview(ov); setCampaigns(camp); setLeadsByCampaign(leads)
      setTopProducts(prods); setContactsEvo(evo); setKanbanDist(kanban)
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

  const kanbanData = Object.entries(kanbanDist).map(([name, value]) => ({ name, value }))
  const kanbanTotal = Object.values(kanbanDist).reduce((a, b) => a + b, 0)
  const L = loading

  return (
    <>
      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)', boxShadow: '0 8px 32px rgba(124,58,237,0.4)' }}
            className="flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold text-white animate-in slide-in-from-right">
            {t.message}
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} className="ml-2 opacity-70 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>

      <div className="p-6 space-y-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 0px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">Sigue tus métricas y gestiona tu atención</p>
          </div>
          <button onClick={fetchData} disabled={loading}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs text-gray-400 hover:bg-white/10 disabled:opacity-40">
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
          {[
            { label: 'Conversaciones', value: L ? '–' : String(overview?.conversations_total ?? 0), sub: `${overview?.conversations_total ?? 0} hoy`, icon: '💬', glow: 'rgba(59,130,246,0.15)' },
            { label: 'IA Atendiendo', value: L ? '–' : String(overview?.ia_attending ?? 0), sub: `${overview?.ia_attending ?? 0} total`, icon: '🤖', glow: 'rgba(168,85,247,0.15)' },
            { label: 'Tasa Conversión', value: L ? '–' : (overview?.conversion_rate ?? '0%'), sub: 'Personas que compraron', icon: '📈', glow: 'rgba(16,185,129,0.15)' },
            { label: 'Valor Productos', value: L ? '–' : `BOB ${(overview?.product_value ?? 0).toFixed(2)}`, sub: 'Total vendido', icon: '💰', glow: 'rgba(245,158,11,0.15)' },
            { label: 'Ventas', value: L ? '–' : String(overview?.sales_count ?? 0), sub: 'Productos vendidos', icon: '🛒', glow: 'rgba(239,68,68,0.15)' },
            { label: 'Clientes', value: L ? '–' : String(overview?.clients ?? 0), sub: 'Contactos que compraron', icon: '👥', glow: 'rgba(6,182,212,0.15)' },
          ].map(card => (
            <div key={card.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: `0 4px 24px ${card.glow}` }}
              className="rounded-2xl p-4 hover:bg-white/[0.04] transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{card.label}</span>
                <span className="text-lg">{card.icon}</span>
              </div>
              <p className={`text-2xl font-extrabold text-white ${L ? 'animate-pulse' : ''}`}>{card.value}</p>
              <p className="text-[10px] text-gray-600 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Contacts Evolution */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Evolución de Contactos</h3>
            <p className="text-[10px] text-gray-600 mb-4">Nuevos contactos por día</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={contactsEvo}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="count" stroke="#7c3aed" fill="url(#colorCount)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Leads by Campaign */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Leads por Campaña</h3>
            <p className="text-[10px] text-gray-600 mb-4">Rendimiento de campañas</p>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {leadsByCampaign.length === 0 ? (
                <p className="text-xs text-gray-600 py-8 text-center">Sin datos de campañas</p>
              ) : leadsByCampaign.map(c => (
                <div key={c.name} style={{ background: 'rgba(255,255,255,0.03)' }} className="rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-300 truncate max-w-[200px]">{c.name}</span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-gray-500">{c.leads} leads</span>
                      <span className="text-emerald-400">{c.conversions} conv.</span>
                      <span className="text-amber-300">{c.rate}</span>
                      <span className="font-bold text-emerald-400">BOB {c.revenue.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                      style={{ width: `${c.leads > 0 ? Math.min(100, (c.conversions / c.leads) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Second row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Kanban Distribution */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Distribución Kanban</h3>
            <p className="text-[10px] text-gray-600 mb-4">Conversaciones por etapa</p>
            <div className="flex items-center gap-6">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={kanbanData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2}>
                      {kanbanData.map((entry) => (
                        <Cell key={entry.name} fill={KANBAN_COLORS[entry.name] ?? '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                {kanbanData.map(k => (
                  <div key={k.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: KANBAN_COLORS[k.name] ?? '#6b7280' }} />
                    <span className="text-[10px] text-gray-400 capitalize flex-1">{k.name}</span>
                    <span className="text-[10px] font-bold text-gray-300">{kanbanTotal > 0 ? Math.round((k.value / kanbanTotal) * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Top Productos</h3>
            <p className="text-[10px] text-gray-600 mb-4">Productos más vendidos</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#d1d5db', fontSize: 10 }} tickLine={false} axisLine={false} width={120} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Bottom stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Campañas', value: campaigns.length, icon: '📣' },
            { label: 'Ejecuciones Totales', value: overview?.total_executions ?? 0, icon: '⚡' },
            { label: 'Actividad', value: contactsEvo.length > 0 ? `${contactsEvo[contactsEvo.length - 1]?.count ?? 0} hoy` : '–', icon: '📊' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              className="rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{s.icon}</span>
                <span className="text-xs text-gray-500">{s.label}</span>
              </div>
              <p className="text-2xl font-extrabold text-white">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Ventas Recientes */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl overflow-hidden">
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Ventas Recientes</h2>
              <p className="text-[10px] text-gray-600 mt-0.5">Pagos verificados automáticamente</p>
            </div>
            <span style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              {overview?.sales_count ?? 0} total
            </span>
          </div>
          <SalesWidget />
        </div>

        {/* Campaigns table (from original) */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} className="rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4">
            <h2 className="text-sm font-semibold text-white">Campañas Meta Ads</h2>
            {campaigns.length > 0 && (
              <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium text-violet-300">
                {campaigns.length} campaña{campaigns.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {campaigns.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-600">Sin campañas registradas</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  className="text-left text-xs font-semibold uppercase tracking-widest text-gray-600">
                  <th className="px-6 py-3">Campaña</th>
                  <th className="px-6 py-3">Meta Ad ID</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Total</th>
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
            </table>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Ventas recientes ─────────────────────────────────────────────────────────
function SalesWidget() {
  const [sales, setSales] = useState<{id:string;product:string;amount:number;created_at:string;contacts?:{phone:string;name:string|null}|null}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    import('@/lib/api').then(({ apiFetch }) => {
      apiFetch<typeof sales>('/api/sales')
        .then(d => setSales((d ?? []).slice(0, 8)))
        .catch(() => {})
        .finally(() => setLoading(false))
    })
  }, [])

  if (loading) return <div className="px-6 py-8 text-center text-xs text-gray-600">Cargando...</div>
  if (!sales.length) return <div className="px-6 py-8 text-center text-xs text-gray-600">Sin ventas aún — los pagos verificados aparecerán aquí</div>

  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-600">
          <th className="px-6 py-3">Contacto</th>
          <th className="px-6 py-3">Producto</th>
          <th className="px-6 py-3">Fecha</th>
          <th className="px-6 py-3 text-right">Monto</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((s, i) => (
          <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
            <td className="px-6 py-3 text-xs text-gray-400 font-mono">
              {s.contacts?.name ?? s.contacts?.phone ?? '–'}
            </td>
            <td className="px-6 py-3 font-medium text-gray-200">{s.product}</td>
            <td className="px-6 py-3 text-xs text-gray-500">
              {new Date(s.created_at).toLocaleDateString('es', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
            </td>
            <td className="px-6 py-3 text-right font-bold text-emerald-400">BOB {Number(s.amount).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
