'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface FlowRef { id: string; name: string }

interface AutoCampaign {
  id:                string
  name:              string
  meta_ad_source_id: string | null
  executions:        number
  active:            boolean
  created_at:        string
  flows:             FlowRef | null
}

interface Keyword {
  id:         string
  keyword:    string
  executions: number
  active:     boolean
  created_at: string
  flows:      FlowRef | null
}

interface SeqMessage { id: string; delay_minutes: number; content: string }

interface Sequence {
  id:         string
  name:       string
  messages:   SeqMessage[]
  executions: number
  active:     boolean
  created_at: string
}

type ActiveTab = 'campaigns' | 'keywords' | 'webhook' | 'sequences'

function uid() { return Math.random().toString(36).slice(2, 10) }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function AutomationPage() {
  const [tab, setTab] = useState<ActiveTab>('campaigns')

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <h1 className="text-xl font-bold text-gray-100">Automatización</h1>

        {/* tabs */}
        <div className="mt-4 flex gap-0 border-b border-white/5">
          {(['campaigns', 'keywords', 'webhook', 'sequences'] as ActiveTab[]).map((t) => {
            const labels: Record<ActiveTab, string> = {
              campaigns: '⚡ Campañas', keywords: '🔑 Palabras Clave',
              webhook: '🔗 Webhook', sequences: '📋 Secuencias',
            }
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}>
                {labels[t]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── contenido ── */}
      <div className="flex-1 overflow-auto">
        {tab === 'campaigns'  && <CampaignsTab />}
        {tab === 'keywords'   && <KeywordsTab />}
        {tab === 'webhook'    && <WebhookTab />}
        {tab === 'sequences'  && <SequencesTab />}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// TAB CAMPAÑAS
// ════════════════════════════════════════════════════════════
function CampaignsTab() {
  const [items,   setItems]   = useState<AutoCampaign[]>([])
  const [flows,   setFlows]   = useState<FlowRef[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    const [campaigns, flows] = await Promise.allSettled([
      apiFetch<AutoCampaign[]>('/api/automation/campaigns'),
      apiFetch<FlowRef[]>('/api/flows'),
    ])
    if (campaigns.status === 'fulfilled') setItems(campaigns.value)
    if (flows.status === 'fulfilled')     setFlows(flows.value)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function toggleActive(item: AutoCampaign) {
    const next = !item.active
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, active: next } : i))
    apiFetch(`/api/automation/campaigns/${item.id}`, {
      method: 'PATCH', body: JSON.stringify({ active: next }),
    }).catch(() => fetch())
  }

  async function del(id: string) {
    if (!confirm('¿Eliminar campaña?')) return
    await apiFetch(`/api/automation/campaigns/${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-gray-500">{loading ? '…' : items.length} campañas</span>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
          + Crear
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#141414] text-left text-xs font-medium text-gray-500">
          <tr>
            <th className="px-6 py-3">Flujo</th>
            <th className="px-6 py-3">Campaña</th>
            <th className="px-6 py-3">Source ID Meta Ads</th>
            <th className="px-6 py-3 text-right">Ejecuciones</th>
            <th className="px-6 py-3 text-center">Status</th>
            <th className="px-6 py-3 w-10" />
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow cols={6} text="Cargando..." />}
          {!loading && items.length === 0 && <EmptyRow cols={6} text="Sin campañas aún" />}
          {items.map((item) => (
            <tr key={item.id} className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors">
              <td className="px-6 py-3 text-xs text-indigo-300">{item.flows?.name ?? <span className="text-gray-600">–</span>}</td>
              <td className="px-6 py-3 font-medium text-gray-100">{item.name}</td>
              <td className="px-6 py-3 font-mono text-xs text-gray-400">{item.meta_ad_source_id ?? <span className="text-gray-600">–</span>}</td>
              <td className="px-6 py-3 text-right font-mono text-gray-300">{item.executions}</td>
              <td className="px-6 py-3 text-center">
                <Toggle active={item.active} onToggle={() => toggleActive(item)} />
              </td>
              <td className="px-6 py-3">
                <button onClick={() => del(item.id)} className="text-gray-600 hover:text-red-400 p-1 rounded hover:bg-red-500/10">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <SimpleModal title="Crear Campaña" onClose={() => setModal(false)}
          onSaved={() => { setModal(false); fetch() }}>
          {(onSubmit, err, loading) => (
            <CampaignForm flows={flows} onSubmit={onSubmit} error={err} loading={loading} />
          )}
        </SimpleModal>
      )}
    </div>
  )
}

function CampaignForm({ flows, onSubmit, error, loading }: {
  flows: FlowRef[]; onSubmit: (data: Record<string, unknown>) => void; error: string; loading: boolean
}) {
  const [name, setName]         = useState('')
  const [flowId, setFlowId]     = useState('')
  const [sourceId, setSourceId] = useState('')

  return (
    <>
      <div className="flex flex-col gap-4">
        <MField label="Nombre de la campaña" required>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Campaña Facebook Verano" className="modal-input" />
        </MField>
        <MField label="Flujo IA asignado">
          <select value={flowId} onChange={(e) => setFlowId(e.target.value)} className="modal-input">
            <option value="">Sin flujo</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </MField>
        <MField label="Source ID de Meta Ad">
          <input value={sourceId} onChange={(e) => setSourceId(e.target.value)}
            placeholder="123456789" className="modal-input" />
          <p className="mt-1 text-[10px] text-gray-500">
            El ID del anuncio de Facebook. Se encuentra en Meta Ads Manager → Anuncios → ID del anuncio
          </p>
        </MField>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      <ModalFooter loading={loading}
        onSubmit={() => onSubmit({ name, flow_id: flowId || null, meta_ad_source_id: sourceId || null })} />
    </>
  )
}

// ════════════════════════════════════════════════════════════
// TAB PALABRAS CLAVE
// ════════════════════════════════════════════════════════════
function KeywordsTab() {
  const [items,   setItems]   = useState<Keyword[]>([])
  const [flows,   setFlows]   = useState<FlowRef[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    // Fetches separados para que un fallo no arrastre al otro
    const [keywords, flows] = await Promise.allSettled([
      apiFetch<Keyword[]>('/api/automation/keywords'),
      apiFetch<FlowRef[]>('/api/flows'),
    ])
    if (keywords.status === 'fulfilled') setItems(keywords.value)
    if (flows.status === 'fulfilled')    setFlows(flows.value)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function toggleActive(item: Keyword) {
    const next = !item.active
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, active: next } : i))
    apiFetch(`/api/automation/keywords/${item.id}`, {
      method: 'PATCH', body: JSON.stringify({ active: next }),
    }).catch(() => fetch())
  }

  async function del(id: string) {
    if (!confirm('¿Eliminar palabra clave?')) return
    await apiFetch(`/api/automation/keywords/${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-gray-500">{loading ? '…' : items.length} palabras clave</span>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
          + Crear
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#141414] text-left text-xs font-medium text-gray-500">
          <tr>
            <th className="px-6 py-3">Palabra clave</th>
            <th className="px-6 py-3">Flujo asignado</th>
            <th className="px-6 py-3 text-right">Ejecuciones</th>
            <th className="px-6 py-3">Creada</th>
            <th className="px-6 py-3 text-center">Status</th>
            <th className="px-6 py-3 w-10" />
          </tr>
        </thead>
        <tbody>
          {loading && <EmptyRow cols={6} text="Cargando..." />}
          {!loading && items.length === 0 && <EmptyRow cols={6} text="Sin palabras clave" />}
          {items.map((item) => (
            <tr key={item.id} className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors">
              <td className="px-6 py-3">
                <span className="rounded bg-amber-500/10 px-2.5 py-1 font-mono text-xs font-medium text-amber-300">
                  {item.keyword}
                </span>
              </td>
              <td className="px-6 py-3 text-xs text-indigo-300">{item.flows?.name ?? <span className="text-gray-600">–</span>}</td>
              <td className="px-6 py-3 text-right font-mono text-gray-300">{item.executions}</td>
              <td className="px-6 py-3 text-xs text-gray-500">{fmtDate(item.created_at)}</td>
              <td className="px-6 py-3 text-center">
                <Toggle active={item.active} onToggle={() => toggleActive(item)} />
              </td>
              <td className="px-6 py-3">
                <button onClick={() => del(item.id)} className="text-gray-600 hover:text-red-400 p-1 rounded hover:bg-red-500/10">
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <SimpleModal title="Crear Palabra Clave" onClose={() => setModal(false)}
          onSaved={() => { setModal(false); fetch() }}>
          {(onSubmit, err, loading) => (
            <KeywordForm flows={flows} onSubmit={onSubmit} error={err} loading={loading} />
          )}
        </SimpleModal>
      )}
    </div>
  )
}

function KeywordForm({ flows, onSubmit, error, loading }: {
  flows: FlowRef[]; onSubmit: (data: Record<string, unknown>) => void; error: string; loading: boolean
}) {
  const [keyword, setKeyword] = useState('')
  const [flowId,  setFlowId]  = useState('')

  return (
    <>
      <div className="flex flex-col gap-4">
        <MField label="Palabra clave" required>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="info, precio, hola..." className="modal-input" />
          <p className="mt-1 text-[10px] text-gray-500">
            Cuando el contacto escriba esta palabra, se activa el flujo seleccionado
          </p>
        </MField>
        <MField label="Flujo IA">
          <select value={flowId} onChange={(e) => setFlowId(e.target.value)} className="modal-input">
            <option value="">Sin flujo</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </MField>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      <ModalFooter loading={loading}
        onSubmit={() => onSubmit({ keyword, flow_id: flowId || null })} />
    </>
  )
}

// ════════════════════════════════════════════════════════════
// TAB WEBHOOK
// ════════════════════════════════════════════════════════════
function WebhookTab() {
  const [copied, setCopied] = useState<string | null>(null)

  const webhookUrl   = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/whatsapp/webhook`
  const verifyNote   = 'El valor de META_WEBHOOK_VERIFY_TOKEN que configuraste en backend/.env'

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <p className="mb-6 text-sm text-gray-400">
        Pega estas credenciales en{' '}
        <span className="font-medium text-indigo-300">Meta for Developers → WhatsApp → Configuration → Webhook</span>
      </p>

      {[
        { label: 'Callback URL',    value: webhookUrl,  key: 'url',    hint: 'Pegar en el campo "Callback URL" de Meta' },
        { label: 'Verify Token',    value: verifyNote,  key: 'token',  hint: 'Tu valor de META_WEBHOOK_VERIFY_TOKEN en backend/.env', masked: true },
      ].map(({ label, value, key, hint, masked }) => (
        <div key={key} className="mb-5 rounded-xl bg-[#141414] p-4 ring-1 ring-white/5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">{label}</span>
            {!masked && (
              <button onClick={() => copy(value, key)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                  copied === key ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}>
                {copied === key ? '✓ Copiado' : (
                  <>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copiar
                  </>
                )}
              </button>
            )}
          </div>
          <p className={`break-all font-mono text-xs ${masked ? 'text-gray-600 italic' : 'text-gray-200'}`}>
            {value}
          </p>
          {hint && <p className="mt-2 text-[10px] text-gray-600">{hint}</p>}
        </div>
      ))}

      <div className="rounded-xl bg-indigo-500/5 p-4 ring-1 ring-indigo-500/20">
        <p className="text-xs font-medium text-indigo-300 mb-2">Suscripciones requeridas en Meta</p>
        <div className="flex flex-wrap gap-2">
          {['messages', 'messaging_postbacks', 'messaging_referrals'].map((s) => (
            <span key={s} className="rounded bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] text-indigo-300">{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// TAB SECUENCIAS
// ════════════════════════════════════════════════════════════
function SequencesTab() {
  const [items,   setItems]   = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState<'create' | Sequence | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try { setItems(await apiFetch<Sequence[]>('/api/automation/sequences')) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function toggleActive(item: Sequence) {
    const next = !item.active
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, active: next } : i))
    apiFetch(`/api/automation/sequences/${item.id}`, {
      method: 'PATCH', body: JSON.stringify({ active: next }),
    }).catch(() => fetch())
  }

  async function del(id: string) {
    if (!confirm('¿Eliminar secuencia?')) return
    await apiFetch(`/api/automation/sequences/${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-sm text-gray-500">{loading ? '…' : items.length} secuencias</span>
        <button onClick={() => setModal('create')}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
          + Crear
        </button>
      </div>

      {!loading && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-gray-600">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">Sin secuencias programadas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-6 pb-6 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((seq) => (
            <div key={seq.id} className="rounded-xl bg-[#141414] p-4 ring-1 ring-white/5">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="font-medium text-gray-100">{seq.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{seq.messages.length} mensajes · {seq.executions} ejecuciones</p>
                </div>
                <Toggle active={seq.active} onToggle={() => toggleActive(seq)} />
              </div>

              {/* preview de mensajes */}
              <div className="flex flex-col gap-1.5 mb-3">
                {seq.messages.slice(0, 3).map((msg, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                    <span className="shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-mono text-indigo-300">
                      +{msg.delay_minutes}m
                    </span>
                    <p className="min-w-0 truncate text-xs text-gray-400">{msg.content}</p>
                  </div>
                ))}
                {seq.messages.length > 3 && (
                  <p className="text-center text-[10px] text-gray-600">+{seq.messages.length - 3} más</p>
                )}
              </div>

              <div className="flex gap-1.5">
                <button onClick={() => setModal(seq)}
                  className="flex-1 rounded-lg border border-white/10 py-1.5 text-xs text-gray-400 hover:bg-white/5">
                  Editar
                </button>
                <button onClick={() => del(seq.id)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-600 hover:bg-red-500/10 hover:text-red-400 hover:border-transparent">
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <SequenceModal
          seq={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetch() }}
        />
      )}
    </div>
  )
}

function SequenceModal({ seq, onClose, onSaved }: { seq: Sequence | null; onClose: () => void; onSaved: () => void }) {
  const [name,     setName]     = useState(seq?.name ?? '')
  const [messages, setMessages] = useState<SeqMessage[]>(seq?.messages ?? [])
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  function addMsg() {
    setMessages((prev) => [...prev, { id: uid(), delay_minutes: 60, content: '' }])
  }
  function updMsg<K extends keyof SeqMessage>(id: string, key: K, val: SeqMessage[K]) {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, [key]: val } : m))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setLoading(true); setError('')
    const body = { name: name.trim(), messages }
    try {
      if (seq) {
        await apiFetch(`/api/automation/sequences/${seq.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/api/automation/sequences', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#1a1a1a] shadow-2xl ring-1 ring-white/10 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 shrink-0">
          <h2 className="text-base font-semibold text-gray-100">{seq ? 'Editar secuencia' : 'Nueva secuencia'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="overflow-y-auto px-6 py-5 flex flex-col gap-5">
            <MField label="Nombre de la secuencia" required>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Seguimiento post-registro" className="modal-input" />
            </MField>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">Mensajes programados</label>
                <button type="button" onClick={addMsg}
                  className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-400 hover:bg-white/5">
                  + Adicionar mensaje
                </button>
              </div>

              {messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-gray-600">
                  Sin mensajes — usa el botón para agregar
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((msg, i) => (
                    <div key={msg.id} className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs text-gray-600 w-4">{i + 1}.</span>
                        <div className="flex items-center gap-1">
                          <input type="number" min="1" value={msg.delay_minutes}
                            onChange={(e) => updMsg(msg.id, 'delay_minutes', Number(e.target.value))}
                            className="modal-input w-16 text-center text-xs" />
                          <span className="text-[10px] text-gray-500">min</span>
                        </div>
                      </div>
                      <input value={msg.content}
                        onChange={(e) => updMsg(msg.id, 'content', e.target.value)}
                        placeholder="Mensaje..."
                        className="modal-input flex-1 text-xs" />
                      <button type="button" onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
                        className="mt-0.5 shrink-0 text-gray-600 hover:text-red-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <p className="mx-6 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 border-t border-white/5 px-6 py-4 shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-gray-400 hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {loading ? 'Guardando...' : seq ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// COMPONENTES COMPARTIDOS
// ════════════════════════════════════════════════════════════
function SimpleModal({ title, onClose, onSaved, children }: {
  title:   string
  onClose: () => void
  onSaved: () => void
  children: (onSubmit: (data: Record<string, unknown>) => void, error: string, loading: boolean) => React.ReactNode
}) {
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(data: Record<string, unknown>) {
    setLoading(true); setError('')
    try {
      const path = title.includes('Campaña') ? '/api/automation/campaigns' : '/api/automation/keywords'
      await apiFetch(path, { method: 'POST', body: JSON.stringify(data) })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#1a1a1a] shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children(onSubmit, error, loading)}</div>
      </div>
    </div>
  )
}

function ModalFooter({ loading, onSubmit }: { loading: boolean; onSubmit: () => void }) {
  return (
    <div className="mt-5 flex gap-2">
      <button type="button" onClick={onSubmit} disabled={loading}
        className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
        {loading ? 'Guardando...' : 'Crear'}
      </button>
    </div>
  )
}

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${active ? 'bg-indigo-600' : 'bg-white/10'}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} className="py-14 text-center text-sm text-gray-600">{text}</td></tr>
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function MField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-400">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
