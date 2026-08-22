'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'

interface Overview {
  conversations_total: number; ia_attending: number; conversion_rate: string
  product_value: number; sales_count: number; clients: number; total_executions: number
}
interface Campaign {
  id: string
  name: string
  meta_ad_id: string | null
  leads_count: number
  sales_count: number
  total_revenue: number
  conversion_rate: number
  has_sales: boolean
}
interface LeadByCampaign { name: string; leads: number; conversions: number; rate: string; revenue: number }
interface TopProduct { name: string; count: number; revenue: number }
interface ContactEvolution { date: string; count: number }
interface Toast { id: string; message: string }
interface SaleFilterOption { id: string; product: string; campaign_id: string | null; campaigns?: { name: string } | null }
interface ConversionStats {
  total: number
  by_status: Record<string, number>
  sent_value: number
  attribution_rate: number
  sent: number
  pending: number
  failed: number
  no_attribution: number
}
type DateFilter = 'today' | 'week' | 'month' | 'all'

const KANBAN_COLORS: Record<string, string> = {
  bot: '#3b82f6', open: '#3b82f6', human: '#a855f7', closed: '#f97316',
  converted: '#10b981', disqualified: '#ef4444', abandoned: '#f87171',
}

function rangeQuery(filter: DateFilter, fromDate: string, toDate: string) {
  if (fromDate || toDate) {
    const params = new URLSearchParams()
    if (fromDate) {
      const from = new Date(`${fromDate}T00:00:00`)
      params.set('from', from.toISOString())
    }
    if (toDate) {
      const to = new Date(`${toDate}T23:59:59.999`)
      params.set('to', to.toISOString())
    }
    return params.toString()
  }
  if (filter === 'all') return ''
  const d = new Date()
  if (filter === 'today') d.setHours(0, 0, 0, 0)
  if (filter === 'week') d.setDate(d.getDate() - 7)
  if (filter === 'month') d.setDate(d.getDate() - 30)
  return `from=${encodeURIComponent(d.toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`
}

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [leadsByCampaign, setLeadsByCampaign] = useState<LeadByCampaign[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [contactsEvo, setContactsEvo] = useState<ContactEvolution[]>([])
  const [kanbanDist, setKanbanDist] = useState<Record<string, number>>({})
  const [conversionStats, setConversionStats] = useState<ConversionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [productFilters, setProductFilters] = useState<string[]>([])
  const [campaignFilters, setCampaignFilters] = useState<string[]>([])
  const [confirmedOnly, setConfirmedOnly] = useState(true)
  const [saleOptions, setSaleOptions] = useState<SaleFilterOption[]>([])
  const [allCampaignOptions, setAllCampaignOptions] = useState<{ id: string; name: string }[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(rangeQuery(dateFilter, fromDate, toDate))
      if (productFilters.length) params.set('product', productFilters.join(','))
      if (campaignFilters.length) params.set('campaign_id', campaignFilters.join(','))
      if (confirmedOnly) params.set('status', 'confirmed')
      const qs = params.toString() ? `?${params.toString()}` : ''
      const evoQs = params.toString()
        ? `?${params.toString()}`
        : `?days=${dateFilter === 'week' ? 7 : dateFilter === 'month' ? 30 : dateFilter === 'all' ? 90 : 1}`
      const [ov, camp, leads, prods, evo, kanban, capi] = await Promise.all([
        apiFetch<Overview>(`/api/analytics/overview${qs}`),
        apiFetch<Campaign[]>(`/api/analytics/campaigns${qs}`),
        apiFetch<LeadByCampaign[]>(`/api/analytics/leads-by-campaign${qs}`).catch(() => []),
        apiFetch<TopProduct[]>(`/api/analytics/top-products${qs}`).catch(() => []),
        apiFetch<ContactEvolution[]>(`/api/analytics/contacts-evolution${evoQs}`).catch(() => []),
        apiFetch<Record<string, number>>(`/api/analytics/kanban-distribution${qs}`).catch(() => ({})),
        apiFetch<ConversionStats>(`/api/conversions/stats${qs}`).catch(() => null),
      ])
      setOverview(ov); setCampaigns(camp); setLeadsByCampaign(leads)
      setTopProducts(prods); setContactsEvo(evo); setKanbanDist(kanban)
      setConversionStats(capi)
    } catch (err) { console.error('[dashboard]', err) }
    finally { setLoading(false) }
  }, [campaignFilters, confirmedOnly, dateFilter, fromDate, productFilters, toDate])

  useEffect(() => {
    apiFetch<SaleFilterOption[]>('/api/sales')
      .then(setSaleOptions)
      .catch(() => {})
    apiFetch<{ id: string; name: string }[]>('/api/campaigns')
      .then(setAllCampaignOptions)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const load = async () => { await fetchData() }
    void load()
  }, [fetchData])

  const addToast = useCallback((message: string) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('sales-confirmed')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: 'status=eq.confirmed' },
        (payload) => {
          const amount = (payload.new as { amount?: number }).amount
          addToast(`💰 Nueva venta — $${amount ?? '–'}`)
          fetchData()
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' },
        (payload) => {
          const sale = payload.new as { amount?: number; status?: string }
          if (sale.status !== 'confirmed') return
          addToast(`Nueva venta - $${sale.amount ?? '-'}`)
          fetchData()
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData, addToast])

  const kanbanData = Object.entries(kanbanDist).map(([name, value]) => ({ name, value }))
  const kanbanTotal = Object.values(kanbanDist).reduce((a, b) => a + b, 0)
  const productOptions = [...new Set(saleOptions.map((s) => s.product).filter(Boolean))]
  const campaignOptions = allCampaignOptions.length
    ? allCampaignOptions
    : campaigns.map((c) => ({ id: c.id, name: c.name }))
  const activeFilterCount = productFilters.length + campaignFilters.length + (confirmedOnly ? 1 : 0) + (fromDate || toDate ? 1 : 0)
  const campaignRevenue = campaigns.reduce((sum, campaign) => sum + campaign.total_revenue, 0)
  const campaignsWithSales = campaigns.filter((campaign) => campaign.sales_count > 0).length
  const campaignsWithoutSales = campaigns.filter((campaign) => campaign.sales_count === 0).length
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

      <div className="flex flex-col h-[calc(100vh-0px)]">
    {/* ── Top bar ── */}
    <div style={{ background: '#0d0d14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      className="shrink-0 flex items-center gap-3 px-6 py-3">
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        className="flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5">
        <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input placeholder="Buscar métricas o bots..." className="flex-1 bg-transparent text-sm text-gray-400 placeholder-gray-600 outline-none" />
      </div>
      <button onClick={fetchData} disabled={loading}
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:text-white disabled:opacity-40 transition-colors">
        <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
      <Link href="/constructor-ia"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shrink-0">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Crear Flujo
      </Link>
    </div>

    <div className="relative flex-1 overflow-auto p-3 space-y-4 sm:p-6 sm:space-y-6">
        <div className="pointer-events-none fixed right-10 top-24 h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="pointer-events-none fixed bottom-16 left-72 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-violet-400/15 bg-gradient-to-br from-violet-500/10 via-white/[0.03] to-emerald-500/10 p-4 shadow-[0_0_40px_rgba(124,58,237,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-violet-300">Centro de mando IA</p>
              <h1 className="text-xl font-bold text-white">Dashboard</h1>
              <p className="mt-0.5 text-xs text-gray-500">Metricas, ventas y campanas en tiempo real.</p>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-right">
              <p className="text-[10px] uppercase tracking-widest text-emerald-300">Pulso actual</p>
              <p className="text-lg font-black text-white">{overview?.conversion_rate ?? '0%'}</p>
            </div>
          </div>
        </div>

        <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-[0_0_32px_rgba(15,23,42,0.25)]">
          <div className="flex flex-wrap items-center gap-2">
            {(['today', 'week', 'month', 'all'] as DateFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => { setDateFilter(f); setFromDate(''); setToDate('') }}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  dateFilter === f && !fromDate && !toDate ? 'bg-violet-600 text-white shadow-[0_0_18px_rgba(124,58,237,0.35)]' : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                {f === 'today' ? 'Hoy' : f === 'week' ? '7 dias' : f === 'month' ? '30 dias' : 'Todo'}
              </button>
            ))}
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#141421] px-3 text-xs text-gray-300 outline-none focus:border-violet-400" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-[#141421] px-3 text-xs text-gray-300 outline-none focus:border-violet-400" />
            <button
              onClick={() => setConfirmedOnly((v) => !v)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                confirmedOnly ? 'bg-emerald-600 text-white' : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              Convertidos
            </button>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${
                filtersOpen ? 'border-violet-400/40 bg-violet-500/15 text-violet-200' : 'border-white/10 bg-white/5 text-gray-300 hover:text-white'
              }`}
            >
              Filtros
              {activeFilterCount > 0 && <span className="rounded-full bg-violet-500 px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span>}
              <span className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`}>⌄</span>
            </button>
          </div>

          {filtersOpen && (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <FilterChips
                title="Productos"
                emptyLabel="Todos los productos"
                options={productOptions.map((p) => ({ id: p, name: p }))}
                selected={productFilters}
                onToggle={(id) => setProductFilters((prev) => toggleValue(prev, id))}
                onClear={() => setProductFilters([])}
              />
              <FilterChips
                title="Campanas"
                emptyLabel="Todas las campanas"
                options={campaignOptions}
                selected={campaignFilters}
                onToggle={(id) => setCampaignFilters((prev) => toggleValue(prev, id))}
                onClear={() => setCampaignFilters([])}
              />
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: 'Meta CAPI enviados', value: L ? '–' : String(conversionStats?.sent ?? 0), sub: `${conversionStats?.total ?? 0} eventos totales`, tone: 'emerald' },
            { label: 'Valor atribuido', value: L ? '–' : `BOB ${(conversionStats?.sent_value ?? 0).toFixed(2)}`, sub: 'Compras enviadas a Meta', tone: 'amber' },
            { label: 'Con CTWA', value: L ? '–' : `${conversionStats?.attribution_rate ?? 0}%`, sub: 'Eventos con click de anuncio', tone: 'violet' },
            { label: 'Pendientes/Fallidas', value: L ? '–' : `${conversionStats?.pending ?? 0}/${conversionStats?.failed ?? 0}`, sub: 'Cola de reintentos CAPI', tone: 'red' },
          ].map((card) => (
            <Link
              key={card.label}
              href="/conversiones"
              className={`rounded-2xl border bg-white/[0.03] p-4 transition hover:bg-white/[0.05] ${
                card.tone === 'emerald' ? 'border-emerald-400/15 shadow-[0_0_24px_rgba(16,185,129,0.08)]' :
                card.tone === 'amber' ? 'border-amber-400/15 shadow-[0_0_24px_rgba(245,158,11,0.08)]' :
                card.tone === 'violet' ? 'border-violet-400/15 shadow-[0_0_24px_rgba(124,58,237,0.10)]' :
                'border-red-400/15 shadow-[0_0_24px_rgba(239,68,68,0.08)]'
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{card.label}</p>
              <p className="mt-2 text-2xl font-extrabold text-white">{card.value}</p>
              <p className="mt-1 text-[10px] text-gray-600">{card.sub}</p>
            </Link>
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
                  <div className="mb-1 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate text-xs font-medium text-gray-300 sm:max-w-[220px]">{c.name}</span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Campañas', value: campaigns.length, icon: '📣' },
            { label: 'Con venta', value: campaignsWithSales, icon: 'BOB' },
            { label: 'Sin venta', value: campaignsWithoutSales, icon: '0' },
            { label: 'Ingresos campanas', value: `BOB ${campaignRevenue.toFixed(0)}`, icon: '$' },
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
          <div className="overflow-x-auto">
            <SalesWidget />
          </div>
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
            <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                  className="text-left text-xs font-semibold uppercase tracking-widest text-gray-600">
                  <th className="px-6 py-3">Campaña</th>
                  <th className="px-6 py-3">Meta Ad ID</th>
                  <th className="px-6 py-3 text-right">Leads</th>
                  <th className="px-6 py-3 text-right">Ventas</th>
                  <th className="px-6 py-3 text-right">Conv.</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td className="px-6 py-3 font-medium text-gray-200">{c.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{c.meta_ad_id ?? '–'}</td>
                    <td className="px-6 py-3 text-right text-gray-300">{c.leads_count}</td>
                    <td className="px-6 py-3 text-right text-gray-300">{c.sales_count}</td>
                    <td className="px-6 py-3 text-right text-amber-300">{c.conversion_rate.toFixed(1)}%</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-400">BOB {c.total_revenue.toFixed(2)}</td>
                    <td className="px-6 py-3 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.has_sales ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                        {c.has_sales ? 'Vendio' : 'Sin venta'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}

function FilterChips({
  title,
  emptyLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  title: string
  emptyLabel: string
  options: { id: string; name: string }[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{title}</p>
        {selected.length > 0 && (
          <button onClick={onClear} className="text-[10px] font-semibold text-violet-300 hover:text-white">
            Limpiar
          </button>
        )}
      </div>
      <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
        {options.length === 0 ? (
          <span className="text-xs text-gray-600">{emptyLabel}</span>
        ) : (
          options.map((option) => {
            const active = selected.includes(option.id)
            return (
              <button
                key={option.id}
                onClick={() => onToggle(option.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200 shadow-[0_0_14px_rgba(16,185,129,0.18)]'
                    : 'border-white/10 bg-white/5 text-gray-400 hover:border-violet-400/40 hover:text-white'
                }`}
              >
                {option.name}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Ventas recientes ─────────────────────────────────────────────────────────
function SalesWidget() {
  const [sales, setSales] = useState<{id:string;product:string;amount:number;created_at:string;contacts?:{phone:string;name:string|null}|null}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    import('@/lib/api').then(({ apiFetch }) => {
      apiFetch<typeof sales>('/api/sales?status=confirmed')
        .then(d => setSales((d ?? []).slice(0, 8)))
        .catch(() => {})
        .finally(() => setLoading(false))
    })
  }, [])

  if (loading) return <div className="px-6 py-8 text-center text-xs text-gray-600">Cargando...</div>
  if (!sales.length) return <div className="px-6 py-8 text-center text-xs text-gray-600">Sin ventas aún — los pagos verificados aparecerán aquí</div>

  return (
    <table className="min-w-[620px] w-full text-sm">
      <thead>
        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-600">
          <th className="px-4 py-3 sm:px-6">Contacto</th>
          <th className="px-4 py-3 sm:px-6">Producto</th>
          <th className="px-4 py-3 sm:px-6">Fecha</th>
          <th className="px-4 py-3 text-right sm:px-6">Monto</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((s, i) => (
          <tr key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
            <td className="px-4 py-3 text-xs text-gray-400 font-mono sm:px-6">
              {s.contacts?.name ?? s.contacts?.phone ?? '–'}
            </td>
            <td className="px-4 py-3 font-medium text-gray-200 sm:px-6">{s.product}</td>
            <td className="px-4 py-3 text-xs text-gray-500 sm:px-6">
              {new Date(s.created_at).toLocaleDateString('es', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
            </td>
            <td className="px-4 py-3 text-right font-bold text-emerald-400 sm:px-6">BOB {Number(s.amount).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
