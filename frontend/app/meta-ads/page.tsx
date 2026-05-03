'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Campaign {
  id:           string
  name:         string
  status:       'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  spend:        number
  impressions:  number
  clicks:       number
  ctr:          number
  leads:        number
  conversions:  number
  revenue:      number
  roas:         number | null
  daily_budget: number | null
}

type DatePreset = 'today' | 'last_7d' | 'last_30d' | 'this_month'

const DATE_LABELS: Record<DatePreset, string> = {
  today:      'Hoy',
  last_7d:    '7 días',
  last_30d:   '30 días',
  this_month: 'Este mes',
}

function fmtMoney(n: number) {
  return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── página ───────────────────────────────────────────────────────────────────
export default function MetaAdsPage() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    apiFetch<{ connected: boolean }>('/api/meta-ads/status')
      .then((d) => setConnected(d.connected))
      .catch(() => setConnected(false))
  }, [])

  if (connected === null) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f0f0f] text-gray-500 text-sm">
        Cargando...
      </div>
    )
  }

  return connected
    ? <Dashboard onDisconnect={() => setConnected(false)} />
    : <ConnectView onConnected={() => setConnected(true)} />
}

// ════════════════════════════════════════════════════════════
// VISTA: SIN CONECTAR
// ════════════════════════════════════════════════════════════
function ConnectView({ onConnected }: { onConnected: () => void }) {
  const [token,     setToken]     = useState('')
  const [accountId, setAccountId] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim() || !accountId.trim()) {
      setError('Ambos campos son obligatorios'); return
    }
    setLoading(true); setError('')
    try {
      await apiFetch('/api/meta-ads/connect', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim(), account_id: accountId.trim() }),
      })
      onConnected()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar')
    } finally { setLoading(false) }
  }

  const steps = [
    {
      n: '1',
      title: 'Crea una app de Meta',
      desc: 'Ve a developers.facebook.com → Mis Apps → Crear App → Tipo: Empresa',
    },
    {
      n: '2',
      title: 'Agrega el producto Marketing API',
      desc: 'En tu app → Agregar Productos → Marketing API → Configurar',
    },
    {
      n: '3',
      title: 'Genera el Access Token',
      desc: 'Marketing API → Herramientas → Genera token con permisos: ads_read, ads_management',
    },
    {
      n: '4',
      title: 'Obtén tu Ad Account ID',
      desc: 'Ve a business.facebook.com → Configuración → Cuentas publicitarias → copia el ID (solo números)',
    },
  ]

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#0f0f0f] px-4 py-12">
      <div className="w-full max-w-xl">

        {/* header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600/10">
            <svg className="h-8 w-8 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-100">Conectar Meta Ads</h1>
          <p className="mt-2 text-sm text-gray-500">Conecta tu cuenta de Meta Ads para ver campañas, leads y calcular el ROAS desde NexBot</p>
        </div>

        {/* pasos */}
        <div className="mb-8 rounded-2xl bg-[#141414] p-5 ring-1 ring-white/5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Cómo obtener las credenciales</p>
          <div className="flex flex-col gap-4">
            {steps.map((s) => (
              <div key={s.n} className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600/15 text-xs font-bold text-blue-400">
                  {s.n}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-200">{s.title}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* formulario */}
        <form onSubmit={handleConnect} className="rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5">
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">Access Token de Meta</label>
              <input value={token} onChange={(e) => setToken(e.target.value)}
                type="password" placeholder="EAAxxxxxxxxxxxxx..."
                className="modal-input" />
              <p className="mt-1 text-[10px] text-gray-600">Token generado en Meta for Developers con permisos ads_read + ads_management</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400">Ad Account ID</label>
              <input value={accountId} onChange={(e) => setAccountId(e.target.value)}
                placeholder="1234567890" className="modal-input" />
              <p className="mt-1 text-[10px] text-gray-600">Solo los números, sin "act_". Ej: 1234567890</p>
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            {loading ? 'Verificando credenciales...' : 'Conectar Meta Ads'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════
function Dashboard({ onDisconnect }: { onDisconnect: () => void }) {
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([])
  const [loading,    setLoading]    = useState(true)
  const [datePreset, setDatePreset] = useState<DatePreset>('last_30d')
  const [toggling,   setToggling]   = useState<string | null>(null)
  const [calcRoas,   setCalcRoas]   = useState(false)

  const fetchCampaigns = useCallback(async (preset: DatePreset) => {
    setLoading(true)
    try {
      const data = await apiFetch<Campaign[]>(`/api/meta-ads/campaigns?date_preset=${preset}`)
      setCampaigns(data)
    } catch (err) { console.error('[meta-ads]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchCampaigns(datePreset) }, [datePreset, fetchCampaigns])

  async function toggleStatus(c: Campaign) {
    setToggling(c.id)
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setCampaigns((prev) => prev.map((x) => x.id === c.id ? { ...x, status: next } : x))
    try {
      await apiFetch(`/api/meta-ads/campaigns/${c.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: next }),
      })
    } catch {
      setCampaigns((prev) => prev.map((x) => x.id === c.id ? { ...x, status: c.status } : x))
    } finally { setToggling(null) }
  }

  async function handleDisconnect() {
    if (!confirm('¿Desconectar Meta Ads?')) return
    await apiFetch('/api/meta-ads/disconnect', { method: 'DELETE' })
    onDisconnect()
  }

  // métricas totales
  const totalSpend    = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalRevenue  = campaigns.reduce((s, c) => s + c.revenue, 0)
  const totalLeads    = campaigns.reduce((s, c) => s + c.leads, 0)
  const totalRoas     = totalSpend > 0 ? totalRevenue / totalSpend : 0

  const active = campaigns.filter((c) => c.status === 'ACTIVE').length

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/10">
              <svg className="h-4 w-4 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">Inteligencia Meta Ads</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs text-gray-500">{active} campañas activas</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* filtro fecha */}
            <div className="flex rounded-lg bg-white/5 p-0.5">
              {(Object.keys(DATE_LABELS) as DatePreset[]).map((d) => (
                <button key={d} onClick={() => setDatePreset(d)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    datePreset === d ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  {DATE_LABELS[d]}
                </button>
              ))}
            </div>

            <button
              onClick={() => { setCalcRoas(true); fetchCampaigns(datePreset).then(() => setCalcRoas(false)) }}
              disabled={calcRoas}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 ${calcRoas ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Calcular ROAS
            </button>

            <button onClick={handleDisconnect}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-500 hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400">
              Desconectar
            </button>
          </div>
        </div>

        {/* métricas */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          {[
            { label: 'Gasto total',   value: `$${fmtMoney(totalSpend)}`,   color: 'text-gray-100' },
            { label: 'Ingresos NexBot', value: `$${fmtMoney(totalRevenue)}`, color: 'text-emerald-400' },
            { label: 'Leads totales', value: String(totalLeads),           color: 'text-sky-400' },
            {
              label: 'ROAS global',
              value: totalSpend > 0 ? `${totalRoas.toFixed(2)}x` : '–',
              color: totalRoas >= 2 ? 'text-emerald-400' : totalRoas >= 1 ? 'text-amber-400' : 'text-red-400',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl bg-white/5 px-4 py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${loading ? 'animate-pulse text-gray-600' : color}`}>
                {loading ? '–' : value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── tabla ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#141414] text-left text-xs font-medium text-gray-500">
            <tr>
              <th className="px-6 py-3">Campaña</th>
              <th className="px-6 py-3 text-right">Gasto</th>
              <th className="px-6 py-3 text-right">Leads</th>
              <th className="px-6 py-3 text-right">Conv.</th>
              <th className="px-6 py-3 text-right">Tasa Conv.</th>
              <th className="px-6 py-3 text-right">Ingresos</th>
              <th className="px-6 py-3 text-right">ROAS</th>
              <th className="px-6 py-3 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-16 text-center text-sm text-gray-600">Cargando campañas...</td></tr>
            )}
            {!loading && campaigns.length === 0 && (
              <tr><td colSpan={8} className="py-16 text-center text-sm text-gray-600">Sin campañas en este periodo</td></tr>
            )}
            {campaigns.map((c) => {
              const convRate = c.leads > 0 ? ((c.conversions / c.leads) * 100).toFixed(1) : '0'
              const roasColor = c.roas == null ? 'text-gray-500'
                : c.roas >= 3 ? 'text-emerald-400'
                : c.roas >= 1 ? 'text-amber-400'
                : 'text-red-400'

              return (
                <tr key={c.id} className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                  {/* nombre */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${c.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                      <span className="font-medium text-gray-100">{c.name}</span>
                      {c.daily_budget != null && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-500">
                          ${c.daily_budget}/día
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-3 text-right font-mono text-gray-300">${fmtMoney(c.spend)}</td>
                  <td className="px-6 py-3 text-right text-sky-400">{c.leads}</td>
                  <td className="px-6 py-3 text-right text-emerald-400">{c.conversions}</td>
                  <td className="px-6 py-3 text-right text-gray-400">{convRate}%</td>
                  <td className="px-6 py-3 text-right font-semibold text-emerald-400">${fmtMoney(c.revenue)}</td>

                  {/* ROAS */}
                  <td className={`px-6 py-3 text-right font-bold ${roasColor}`}>
                    {c.roas != null ? `${c.roas}x` : '–'}
                    {c.roas != null && c.roas >= 3 && <span className="ml-1 text-[10px]">🔥</span>}
                  </td>

                  {/* toggle estado */}
                  <td className="px-6 py-3 text-center">
                    <button
                      onClick={() => toggleStatus(c)}
                      disabled={toggling === c.id || c.status === 'DELETED' || c.status === 'ARCHIVED'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                        c.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-white/10'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        c.status === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>

          {!loading && campaigns.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10 bg-[#141414]">
                <td className="px-6 py-3 text-xs font-medium text-gray-500">Total</td>
                <td className="px-6 py-3 text-right font-bold text-gray-200">${fmtMoney(totalSpend)}</td>
                <td className="px-6 py-3 text-right font-bold text-sky-400">{totalLeads}</td>
                <td className="px-6 py-3 text-right font-bold text-emerald-400">
                  {campaigns.reduce((s, c) => s + c.conversions, 0)}
                </td>
                <td className="px-6 py-3 text-right text-gray-400">
                  {totalLeads > 0
                    ? `${((campaigns.reduce((s, c) => s + c.conversions, 0) / totalLeads) * 100).toFixed(1)}%`
                    : '–'}
                </td>
                <td className="px-6 py-3 text-right font-bold text-emerald-400">${fmtMoney(totalRevenue)}</td>
                <td className={`px-6 py-3 text-right font-bold ${
                  totalRoas >= 3 ? 'text-emerald-400' : totalRoas >= 1 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {totalSpend > 0 ? `${totalRoas.toFixed(2)}x` : '–'}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
