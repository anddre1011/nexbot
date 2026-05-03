'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Plan {
  id:            string
  name:          string
  price_bob:     number
  max_contacts:  number
  max_flows:     number
  max_campaigns: number
  max_messages:  number
  features:      string[]
}

interface Subscription {
  id:         string
  status:     string
  started_at: string
  expires_at: string
  plans:      Plan
}

interface Payment {
  id:         string
  amount_bob: number
  method:     string
  reference:  string | null
  status:     string
  notes:      string | null
  created_at: string
  plans:      { name: string } | null
}

const PLAN_COLORS: Record<string, { border: string; badge: string; btn: string; icon: string }> = {
  'Básico':     { border: 'border-gray-700',    badge: 'bg-gray-700 text-gray-200',       btn: 'bg-gray-700 hover:bg-gray-600',      icon: '🌱' },
  'Pro':        { border: 'border-indigo-500',  badge: 'bg-indigo-600 text-white',        btn: 'bg-indigo-600 hover:bg-indigo-500',  icon: '⚡' },
  'Enterprise': { border: 'border-amber-500',   badge: 'bg-amber-500 text-black',         btn: 'bg-amber-500 hover:bg-amber-400',    icon: '👑' },
}

function fmt(n: number) { return n === -1 ? 'Ilimitado' : n.toLocaleString() }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
}
function daysLeft(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

const METHOD_LABEL: Record<string, string> = {
  manual: 'Manual', qr: 'QR', transfer: 'Transferencia', card: 'Tarjeta',
}

// ─── página ───────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const [plans,     setPlans]     = useState<Plan[]>([])
  const [sub,       setSub]       = useState<Subscription | null | undefined>(undefined)
  const [payments,  setPayments]  = useState<Payment[]>([])
  const [loading,   setLoading]   = useState(true)
  const [activating, setActivating] = useState<string | null>(null)
  const [modal,     setModal]     = useState<Plan | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s, pay] = await Promise.all([
        apiFetch<Plan[]>('/api/billing/plans'),
        apiFetch<Subscription | null>('/api/billing/subscription'),
        apiFetch<Payment[]>('/api/billing/payments'),
      ])
      setPlans(p); setSub(s); setPayments(pay)
    } catch (err) { console.error('[billing]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const currentPlanName = sub?.plans?.name

  async function handleActivate(plan: Plan, opts: { method: string; reference: string; notes: string }) {
    setActivating(plan.id)
    try {
      await apiFetch('/api/billing/activate', {
        method: 'POST',
        body: JSON.stringify({ plan_id: plan.id, ...opts }),
      })
      await fetchAll()
      setModal(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al activar')
    } finally { setActivating(null) }
  }

  async function handleCancel() {
    if (!confirm('¿Cancelar la suscripción actual?')) return
    await apiFetch('/api/billing/cancel', { method: 'POST' })
    await fetchAll()
  }

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <h1 className="text-xl font-bold text-gray-100">Facturación</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gestiona tu plan y pagos de NexBot</p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 flex flex-col gap-8">

        {/* ── plan actual ── */}
        {sub !== undefined && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-wide">Plan actual</h2>
            {sub ? (
              <div className="flex items-center justify-between rounded-2xl bg-[#141414] px-6 py-5 ring-1 ring-indigo-500/30">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{PLAN_COLORS[sub.plans.name]?.icon ?? '📦'}</span>
                  <div>
                    <p className="text-lg font-bold text-gray-100">{sub.plans.name}</p>
                    <p className="text-sm text-gray-500">
                      Activo hasta <span className="text-gray-300">{fmtDate(sub.expires_at)}</span>
                      <span className="ml-3 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                        {daysLeft(sub.expires_at)} días restantes
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-bold text-gray-100">
                    BOB {sub.plans.price_bob}<span className="text-sm font-normal text-gray-500">/mes</span>
                  </p>
                  <button onClick={handleCancel}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-500 hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-amber-500/5 px-6 py-5 ring-1 ring-amber-500/20">
                <p className="text-sm font-medium text-amber-300">Sin plan activo</p>
                <p className="text-xs text-gray-500 mt-1">Elige un plan para activar todas las funciones de NexBot</p>
              </div>
            )}
          </section>
        )}

        {/* ── planes ── */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-gray-400 uppercase tracking-wide">Planes disponibles</h2>
          {loading ? (
            <p className="text-sm text-gray-600">Cargando planes...</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {plans.map((plan) => {
                const colors  = PLAN_COLORS[plan.name] ?? PLAN_COLORS['Básico']
                const isCurrent = plan.name === currentPlanName
                const isPro     = plan.name === 'Pro'

                return (
                  <div key={plan.id}
                    className={`relative flex flex-col rounded-2xl bg-[#141414] p-6 border ${colors.border} ${isCurrent ? 'ring-2 ring-offset-2 ring-offset-[#0f0f0f] ring-indigo-500' : ''}`}>

                    {/* badge popular */}
                    {isPro && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-bold text-white">MÁS POPULAR</span>
                      </div>
                    )}

                    {/* badge actual */}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${colors.badge}`}>PLAN ACTUAL</span>
                      </div>
                    )}

                    {/* header */}
                    <div className="mb-5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{colors.icon}</span>
                        <h3 className="text-lg font-bold text-gray-100">{plan.name}</h3>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-gray-100">{plan.price_bob}</span>
                        <span className="text-sm text-gray-500">BOB/mes</span>
                      </div>
                    </div>

                    {/* límites */}
                    <div className="mb-5 flex flex-col gap-2 text-xs">
                      {[
                        ['👥', 'Contactos',   fmt(plan.max_contacts)],
                        ['🤖', 'Flujos IA',   fmt(plan.max_flows)],
                        ['📣', 'Campañas',    fmt(plan.max_campaigns)],
                        ['💬', 'Mensajes/mes', fmt(plan.max_messages)],
                      ].map(([icon, label, value]) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-gray-500">{icon} {label}</span>
                          <span className={`font-medium ${value === 'Ilimitado' ? 'text-emerald-400' : 'text-gray-300'}`}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* features */}
                    <ul className="mb-6 flex flex-col gap-1.5 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-gray-400">
                          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* botón */}
                    <button
                      onClick={() => setModal(plan)}
                      disabled={isCurrent || activating === plan.id}
                      className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
                        isCurrent ? 'bg-white/5 text-gray-500 cursor-default' : `${colors.btn} text-white`
                      }`}
                    >
                      {isCurrent ? 'Plan actual' : `Activar ${plan.name}`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── historial de pagos ── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-400 uppercase tracking-wide">Historial de pagos</h2>
          {payments.length === 0 ? (
            <div className="rounded-2xl bg-[#141414] px-6 py-10 text-center text-sm text-gray-600">
              Sin pagos registrados
            </div>
          ) : (
            <div className="rounded-2xl bg-[#141414] ring-1 ring-white/5 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-white/5">
                    <th className="px-5 py-3">Fecha</th>
                    <th className="px-5 py-3">Plan</th>
                    <th className="px-5 py-3">Método</th>
                    <th className="px-5 py-3">Referencia</th>
                    <th className="px-5 py-3 text-right">Monto (BOB)</th>
                    <th className="px-5 py-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="px-5 py-3 text-xs text-gray-400">{fmtDate(p.created_at)}</td>
                      <td className="px-5 py-3 font-medium text-gray-200">{p.plans?.name ?? '–'}</td>
                      <td className="px-5 py-3 text-xs text-gray-400">{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">{p.reference ?? '–'}</td>
                      <td className="px-5 py-3 text-right font-bold text-emerald-400">{p.amount_bob.toFixed(2)}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                          p.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-400' :
                          p.status === 'pending'   ? 'bg-amber-500/15 text-amber-400' :
                                                     'bg-red-500/15 text-red-400'
                        }`}>
                          {p.status === 'confirmed' ? 'Confirmado' : p.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── modal activar plan ── */}
      {modal && (
        <ActivateModal
          plan={modal}
          loading={activating === modal.id}
          onClose={() => setModal(null)}
          onConfirm={(opts) => handleActivate(modal, opts)}
        />
      )}
    </div>
  )
}

// ─── modal ────────────────────────────────────────────────────────────────────
function ActivateModal({ plan, loading, onClose, onConfirm }: {
  plan:      Plan
  loading:   boolean
  onClose:   () => void
  onConfirm: (opts: { method: string; reference: string; notes: string }) => void
}) {
  const [method,    setMethod]    = useState('transfer')
  const [reference, setReference] = useState('')
  const [notes,     setNotes]     = useState('')

  const colors = PLAN_COLORS[plan.name] ?? PLAN_COLORS['Básico']

  const PAYMENT_METHODS = [
    { id: 'transfer', label: 'Transferencia bancaria', icon: '🏦' },
    { id: 'qr',       label: 'QR / Tigo Money',         icon: '📱' },
    { id: 'manual',   label: 'Otro / Manual',            icon: '✍️' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#1a1a1a] shadow-2xl ring-1 ring-white/10">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{colors.icon}</span>
            <h2 className="text-base font-semibold text-gray-100">Activar plan {plan.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* resumen */}
          <div className={`rounded-xl border ${colors.border} p-4`}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">Total a pagar</p>
              <p className="text-2xl font-bold text-gray-100">BOB {plan.price_bob}</p>
            </div>
            <p className="mt-1 text-xs text-gray-500">Activa por 30 días calendario desde hoy</p>
          </div>

          {/* método */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-400">Método de pago</p>
            <div className="flex flex-col gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    method === m.id ? 'border-indigo-500 bg-indigo-500/10 text-gray-100' : 'border-white/10 text-gray-400 hover:bg-white/5'
                  }`}>
                  <span className="text-lg">{m.icon}</span>
                  {m.label}
                  {method === m.id && (
                    <svg className="ml-auto h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* referencia */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">
              Nro. de referencia / comprobante
            </label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Ej: 123456789" className="modal-input" />
          </div>

          {/* notas */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400">Notas (opcional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Cualquier información adicional" className="modal-input" />
          </div>
        </div>

        <div className="flex gap-2 border-t border-white/5 px-6 py-4">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-gray-400 hover:bg-white/5">
            Cancelar
          </button>
          <button onClick={() => onConfirm({ method, reference, notes })} disabled={loading}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${colors.btn}`}>
            {loading ? 'Activando...' : `Confirmar pago`}
          </button>
        </div>
      </div>
    </div>
  )
}
