'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import FlowStepsBuilder from './FlowStepsBuilder'
import ConversionFlowEditor from './ConversionFlowEditor'
import InactivityRulesEditor from './InactivityRulesEditor'

// ─── tipos ────────────────────────────────────────────────────────────────────
type FlowType  = 'ai' | 'conversational_ai'
type ModelId   = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1' | 'gpt-3.5-turbo' | 'deepseek-v4-pro' | 'deepseek-v4-flash' | 'deepseek-chat' | 'deepseek-reasoner'

interface WelcomeItem       { id: string; type: 'text' | 'image' | 'video'; content: string }
interface InactivityMsg     { id: string; delay: number; unit: 'minutes' | 'hours'; message: string }
interface MediaItem         { id: string; name: string; variable: string | null }

interface Flow {
  id:                    string
  name:                  string
  type:                  FlowType
  model:                 ModelId
  system_prompt:         string | null
  handoff_agent_name:    string | null
  welcome_items:         WelcomeItem[]
  inactivity_messages:   InactivityMsg[]
  conversion_enabled:    boolean
  conversion_message:    string | null
  executions:            number
  active:                boolean
  created_at:            string
}

interface FormState {
  name:                string
  type:                FlowType
  model:               ModelId
  system_prompt:       string
  handoff_agent_name:  string
  welcome_items:       WelcomeItem[]
  inactivity_messages: InactivityMsg[]
  conversion_enabled:  boolean
  conversion_message:  string
  inactivity_delay:    string
  inactivity_unit:     'minutes' | 'hours'
}

const MODELS: { id: ModelId; label: string; desc: string; badge?: string }[] = [
  { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro',   desc: 'DeepSeek — Más capaz, 90% más barato que GPT-4o', badge: '💰 Recomendado' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash',  desc: 'DeepSeek — Ultra rápido y económico', badge: '⚡ Rápido' },
  { id: 'gpt-4o',            label: 'GPT-4o',             desc: 'OpenAI — Multimodal, validación de comprobantes' },
  { id: 'gpt-4o-mini',       label: 'GPT-4o-mini',        desc: 'OpenAI — Rápido y económico' },
  { id: 'gpt-4.1',           label: 'GPT-4.1',            desc: 'OpenAI — Último modelo' },
  { id: 'gpt-3.5-turbo',     label: 'GPT-3.5 Turbo',      desc: 'OpenAI — El más barato de OpenAI' },
  { id: 'deepseek-chat',     label: 'DeepSeek Chat (V3)', desc: 'Deprecado el 24 jul 2026 — migra a V4 Pro' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner',  desc: 'Deprecado el 24 jul 2026 — migra a V4 Pro' },
]

const VARS = [
  { label: '{{nombre}}',      v: '{{nombre}}',      hint: 'Nombre del cliente en WhatsApp' },
  { label: '{{telefono}}',    v: '{{telefono}}',    hint: 'Número de teléfono' },
  { label: '{{saludo}}',      v: '{{saludo}}',      hint: 'Buenos días / tardes / noches (hora Bolivia)' },
  { label: '{{hora_actual}}', v: '{{hora_actual}}', hint: 'Hora actual en Bolivia' },
  { label: '{{dia_semana}}',  v: '{{dia_semana}}',  hint: 'Día de la semana' },
]

const DEFAULT_PROMPT = `Eres un asistente de ventas de {{product_name}} por WhatsApp.
Tu objetivo es responder dudas y guiar al cliente hacia la compra.

Producto: {{product_name}}
Precio: {{price}}
Métodos de pago: {{payment_methods}}

Reglas:
- Respuestas cortas y amables (máximo 3 oraciones)
- Si preguntan el precio, indícalo claramente
- Cuando el cliente quiera pagar, explica los métodos de pago`

function uid() { return Math.random().toString(36).slice(2, 8) }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

const EMPTY: FormState = {
  name: '', type: 'ai', model: 'gpt-4o', system_prompt: DEFAULT_PROMPT,
  handoff_agent_name: '', welcome_items: [], inactivity_messages: [],
  conversion_enabled: false, conversion_message: '', inactivity_delay: '60', inactivity_unit: 'minutes',
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function ConstructorIAPage() {
  const [flows,   setFlows]   = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [panel,   setPanel]   = useState<'closed' | 'new' | Flow>('closed')
  const [medias,  setMedias]  = useState<MediaItem[]>([])

  const fetchFlows = useCallback(async () => {
    setLoading(true)
    try { setFlows(await apiFetch<Flow[]>('/api/flows')) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchFlows()
    apiFetch<MediaItem[]>('/api/media').then(setMedias).catch(() => {})
  }, [fetchFlows])

  async function toggleActive(flow: Flow) {
    setFlows((p) => p.map((f) => f.id === flow.id ? { ...f, active: !f.active } : f))
    apiFetch(`/api/flows/${flow.id}`, { method: 'PATCH', body: JSON.stringify({ active: !flow.active }) })
      .catch(() => fetchFlows())
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este flujo?')) return
    await apiFetch(`/api/flows/${id}`, { method: 'DELETE' })
    setFlows((p) => p.filter((f) => f.id !== id))
  }

  const panelOpen = panel !== 'closed'

  return (
    <div className="relative flex h-[calc(100vh-0px)] overflow-hidden bg-[#0a0a0f]">

      {/* ── lista principal ── */}
      <div className={`flex flex-1 flex-col transition-all duration-300 ${panelOpen ? 'mr-[500px]' : ''}`}>

        {/* Header */}
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#0d0d14' }}
          className="shrink-0 flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold text-white">Constructor IA</h1>
            <p className="text-sm text-gray-500 mt-0.5">{loading ? '…' : `${flows.length} flujos`}</p>
          </div>
          <button onClick={() => setPanel('new')}
            style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 transition-all">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Crear Flujo
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center gap-3 pt-8 text-sm text-gray-600">
              <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} className="h-5 w-5 animate-spin rounded-full opacity-60" />
              Cargando flujos...
            </div>
          ) : flows.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(255,255,255,0.06)' }}
              className="flex flex-col items-center gap-4 rounded-2xl py-24">
              <span className="text-5xl">🤖</span>
              <p className="text-sm text-gray-600">Sin flujos aún</p>
              <button onClick={() => setPanel('new')}
                style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">
                Crear primer flujo
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {flows.map((flow) => (
                <div key={flow.id}
                  style={{ background: panel !== 'closed' && typeof panel === 'object' && panel.id === flow.id ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${panel !== 'closed' && typeof panel === 'object' && panel.id === flow.id ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)'}` }}
                  className="flex items-center gap-4 rounded-2xl p-5 transition-all hover:bg-white/[0.04] cursor-pointer"
                  onClick={() => setPanel(flow)}>

                  {/* Icono */}
                  <div style={{ background: flow.active ? 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2))' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl">
                    {flow.type === 'ai' ? '🤖' : '💬'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-100">{flow.name}</p>
                      <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                        className="rounded-full px-2 py-0.5 text-[10px] font-mono text-gray-500">
                        {flow.model}
                      </span>
                      {flow.conversion_enabled && (
                        <span style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                          💰 Conversión
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 truncate">
                      {flow.system_prompt ? flow.system_prompt.slice(0, 80) + '…' : 'Sin prompt'}
                    </p>
                    <p className="mt-1 text-[10px] text-gray-600">{flow.executions} ejecuciones · {fmtDate(flow.created_at)}</p>
                  </div>

                  {/* Controles */}
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleActive(flow)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${flow.active ? 'bg-indigo-600' : 'bg-white/10'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${flow.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <button onClick={() => handleDelete(flow.id)}
                      className="rounded-lg p-1.5 text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── panel lateral deslizante ── */}
      {panelOpen && (
        <FlowPanel
          flow={typeof panel === 'object' ? panel : null}
          medias={medias}
          onClose={() => setPanel('closed')}
          onSaved={() => { setPanel('closed'); fetchFlows() }}
        />
      )}
    </div>
  )
}

// ─── panel lateral ────────────────────────────────────────────────────────────
function FlowPanel({ flow, medias, onClose, onSaved }: {
  flow:     Flow | null
  medias:   MediaItem[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const isEdit = !!flow
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm]       = useState<FormState>(() => flow ? {
    name:                flow.name,
    type:                flow.type,
    model:               flow.model,
    system_prompt:       flow.system_prompt ?? DEFAULT_PROMPT,
    handoff_agent_name:  flow.handoff_agent_name ?? '',
    welcome_items:       flow.welcome_items ?? [],
    inactivity_messages: flow.inactivity_messages ?? [],
    conversion_enabled:  flow.conversion_enabled,
    conversion_message:  flow.conversion_message ?? '',
    inactivity_delay:    '60',
    inactivity_unit:     'minutes',
  } : { ...EMPTY })
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')
  const [generating,      setGenerating]      = useState(false)
  const [showMediaPicker,   setShowMediaPicker]   = useState(false)
  const [promptExpanded,    setPromptExpanded]    = useState(false)
  const [uploadingMedia,    setUploadingMedia]    = useState(false)
  const [pendingMedia,      setPendingMedia]      = useState<{url: string; varName: string} | null>(null)
  const [uploadKey,         setUploadKey]         = useState(0)

  // ─── Estado de pasos, conversiones e inactividad ───────────────────────────
  const [flowSteps, setFlowSteps] = useState<any[]>([])
  const [conversions, setConversions] = useState<any[]>([])
  const [inactRules, setInactRules] = useState<any[]>([])

  useEffect(() => {
    if (!flow?.id) {
      setFlowSteps([]); setConversions([]); setInactRules([])
      return
    }
    // Cargar datos del flujo existente para edición
    Promise.all([
      apiFetch<any[]>(`/api/flows/${flow.id}/steps`),
      apiFetch<any[]>(`/api/flows/${flow.id}/conversions`),
      apiFetch<any[]>(`/api/flows/${flow.id}/inactivity-rules`),
    ]).then(([steps, convs, rules]) => {
      setFlowSteps(Array.isArray(steps) ? steps : [])
      setConversions(Array.isArray(convs) ? convs : [])
      setInactRules(Array.isArray(rules) ? rules : [])
    }).catch((err) => {
      console.error('[FlowPanel] load error:', err)
      setFlowSteps([]); setConversions([]); setInactRules([])
    })
  }, [flow?.id])

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  function insertAtCursor(text: string) {
    const ta = promptRef.current
    if (!ta) { set('system_prompt', form.system_prompt + text); return }
    const start = ta.selectionStart; const end = ta.selectionEnd
    const before = form.system_prompt.slice(0, start)
    const after  = form.system_prompt.slice(end)
    const next   = before + text + after
    set('system_prompt', next)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length) }, 0)
  }

  async function handleGeneratePrompt() {
    setGenerating(true)
    try {
      const { prompt } = await apiFetch<{ prompt: string }>('/api/flows/generate-prompt', {
        method: 'POST',
        body: JSON.stringify({ product_name: 'mi producto', business_name: form.name || 'Mi Negocio' }),
      })
      if (prompt) set('system_prompt', prompt)
    } catch { /* silencioso — ya tiene prompt default */ }
    finally { setGenerating(false) }
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true); setError('')
    const body = {
      name:               form.name.trim(),
      type:               form.type,
      model:              form.model,
      system_prompt:      form.system_prompt || null,
      handoff_agent_name: form.handoff_agent_name || null,
      welcome_items:      [],
      inactivity_messages: [],
      conversion_enabled: conversions.length > 0,
      conversion_message: null,
    }
    try {
      let flowId: string
      if (isEdit) {
        await apiFetch(`/api/flows/${flow.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        flowId = flow.id
      } else {
        const created = await apiFetch<{ id: string }>('/api/flows', { method: 'POST', body: JSON.stringify(body) })
        flowId = created.id
      }
      // Guardar steps, conversions y reglas de inactividad en paralelo
      await Promise.all([
        apiFetch(`/api/flows/${flowId}/steps`,            { method: 'PUT', body: JSON.stringify(flowSteps) }),
        apiFetch(`/api/flows/${flowId}/conversions`,       { method: 'PUT', body: JSON.stringify(conversions) }),
        apiFetch(`/api/flows/${flowId}/inactivity-rules`, { method: 'PUT', body: JSON.stringify(inactRules) }),
      ])
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div style={{ background: '#0d0d14', borderLeft: '1px solid rgba(255,255,255,0.07)', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)' }}
        className="fixed right-0 top-0 z-40 flex h-full w-[500px] flex-col">

        {/* Header */}
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          className="flex items-center justify-between px-6 py-4 shrink-0">
          <h2 className="text-base font-bold text-white">{isEdit ? 'Editar flujo' : 'Nuevo flujo'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {/* Tabs tipo */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            className="flex gap-1 rounded-xl p-1">
            {([['ai', '🤖 IA'], ['conversational_ai', '💬 Conversacional + IA']] as [FlowType, string][]).map(([t, l]) => (
              <button key={t} onClick={() => set('type', t)}
                style={form.type === t ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2))', border: '1px solid rgba(124,58,237,0.4)' } : {}}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${form.type === t ? 'text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Nombre */}
          <InputField label="Nombre del flujo" value={form.name} onChange={(v) => set('name', v)} placeholder="Flujo de ventas principal" required />

          {/* Modelo */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Modelo IA</label>
            <div className="relative">
              <select value={form.model} onChange={(e) => set('model', e.target.value as ModelId)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', appearance: 'none' }}
                className="w-full rounded-xl px-4 py-3 pr-10 text-sm text-white outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 cursor-pointer">
                {MODELS.map(({ id, label, desc, badge }) => (
                  <option key={id} value={id} className="bg-[#1a1a24] text-white">
                    {badge ? `${badge} — ` : ''}{label} — {desc}
                  </option>
                ))}
              </select>
              {/* Chevron */}
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {/* Badge del modelo seleccionado */}
            {MODELS.find(m => m.id === form.model)?.badge && (
              <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold text-violet-300">
                {MODELS.find(m => m.id === form.model)?.badge}
              </span>
            )}
          </div>

          {/* Prompt editor */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Prompt del agente</label>
              <div className="flex items-center gap-1.5">
                {/* Expandir / comprimir */}
                <button onClick={() => setPromptExpanded(p => !p)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                  className="rounded-lg px-2 py-1 text-[10px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  title={promptExpanded ? 'Comprimir' : 'Expandir'}>
                  {promptExpanded ? '⊡' : '⊞'}
                </button>
                <button onClick={handleGeneratePrompt} disabled={generating}
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/20 transition-colors disabled:opacity-40">
                  {generating ? '⏳' : '✨'} {generating ? 'Generando...' : 'Crear con IA'}
                </button>
              </div>
            </div>

            {/* Variables */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {VARS.map(({ label, v }) => (
                <button key={v} onClick={() => insertAtCursor(v)}
                  style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)' }}
                  className="rounded-lg px-2 py-0.5 font-mono text-[10px] text-blue-300 hover:bg-blue-500/20 transition-colors">
                  {label}
                </button>
              ))}

              {/* Media picker con upload */}
              <div className="relative">
                <button onClick={() => setShowMediaPicker(p => !p)}
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}
                  className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition-colors">
                  📁 Media
                </button>

                {showMediaPicker && (
                  <div style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 40px rgba(0,0,0,0.8)' }}
                    className="absolute left-0 top-7 z-20 rounded-xl p-2 w-64 max-h-64 overflow-y-auto">

                    {/* Upload + rename antes de insertar */}
                    {pendingMedia ? (
                      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}
                        className="rounded-xl p-2.5 mb-2">
                        <p className="text-[10px] text-emerald-400 mb-1.5">✓ Subido — edita el nombre:</p>
                        <input
                          value={pendingMedia.varName}
                          onChange={e => setPendingMedia(p => p ? { ...p, varName: e.target.value.replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase() } : null)}
                          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
                          className="w-full rounded-lg px-2 py-1 font-mono text-xs text-white outline-none mb-1.5" />
                        <div className="flex gap-1.5">
                          <button onClick={async () => {
                            const v = `{{media:${pendingMedia.varName}}}`
                            // Añadir al final del prompt (evita problema de cursor fuera de foco)
                            set('system_prompt', (form.system_prompt ?? '') + '\n' + v)
                            // Guardar en tabla media para que aparezca en Biblioteca
                            apiFetch('/api/media', { method: 'POST', body: JSON.stringify({ name: pendingMedia.varName, type: 'image', url: pendingMedia.url, variable: v }) }).catch(() => {})
                            setPendingMedia(null)
                            setShowMediaPicker(false)
                          }}
                          style={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)' }}
                          className="flex-1 rounded-lg py-1.5 text-[10px] font-bold text-white hover:opacity-90 transition-all">
                            ↓ Añadir al prompt
                          </button>
                          <button onClick={() => setPendingMedia(null)}
                            className="rounded-lg px-2 py-1.5 text-[10px] text-gray-500 hover:text-red-400 transition-colors">
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label
                        style={{ background: uploadingMedia ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.15)', border: '1px dashed rgba(124,58,237,0.35)', cursor: uploadingMedia ? 'not-allowed' : 'pointer' }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 mb-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/25 transition-colors">
                        {uploadingMedia ? '⏳ Subiendo...' : '📤 Subir imagen / video / audio'}
                        <input key={uploadKey} type="file" accept="image/*,video/*,audio/*" className="hidden"
                          disabled={uploadingMedia}
                          onChange={async e => {
                            const file = e.target.files?.[0]; if (!file) return
                            setUploadingMedia(true)
                            try {
                              const ext = file.type.split('/')[0]
                              const short = `${ext}_${Date.now().toString().slice(-4)}`
                              // Solo subir a storage — no guardar en DB todavía (se guarda al confirmar nombre)
                              const { createClient } = await import('@/lib/supabase/client')
                              const { data: { session } } = await createClient().auth.getSession()
                              const token = session?.access_token ?? ''
                              const fd = new FormData(); fd.append('file', file)
                              const res = await fetch('https://nexbot.pro/api/upload/flow-media', {
                                method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` }
                              })
                              if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error ?? `Error ${res.status}`) }
                              const { url } = await res.json()
                              setPendingMedia({ url, varName: short })
                            } catch (err) { alert('Error al subir: ' + (err instanceof Error ? err.message : 'desconocido')) }
                            finally { setUploadingMedia(false); setUploadKey(k => k + 1) }
                          }} />
                      </label>
                    )}

                    {/* Variables de steps del flujo actual */}
                    {flowSteps.filter((s: any) => s.variable_name).length > 0 && (
                      <>
                        <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-widest text-gray-600">Del flujo</p>
                        {flowSteps.filter((s: any) => s.variable_name).map((s: any) => (
                          <button key={s.id} onClick={() => { insertAtCursor(`{{media:${s.variable_name}}}`); setShowMediaPicker(false) }}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                            <span>{s.type === 'image' ? '🖼️' : s.type === 'video' ? '🎬' : '🔊'}</span>
                            <span className="truncate font-mono text-[10px] text-amber-300">{`{{media:${s.variable_name}}}`}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Biblioteca de medias */}
                    {medias.filter(m => m.variable).length > 0 && (
                      <>
                        <p className="px-2 mb-1 mt-2 text-[9px] font-bold uppercase tracking-widest text-gray-600">Biblioteca</p>
                        {medias.filter(m => m.variable).map(m => (
                          <button key={m.id} onClick={() => { insertAtCursor(m.variable!); setShowMediaPicker(false) }}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                            <span>🖼️</span>
                            <span className="truncate flex-1">{m.name}</span>
                            <span className="font-mono text-[9px] text-amber-300 shrink-0">{m.variable}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {flowSteps.filter((s: any) => s.variable_name).length === 0 && medias.filter(m => m.variable).length === 0 && (
                      <p className="px-2 py-1 text-xs text-gray-600">Sin medias. Sube una arriba.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <textarea ref={promptRef}
              rows={promptExpanded ? 22 : 8}
              value={form.system_prompt}
              onChange={(e) => set('system_prompt', e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
              className="w-full rounded-xl px-4 py-3 font-mono text-xs leading-relaxed text-gray-200 placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-none" />
          </div>

          {/* Handoff */}
          <InputField label="Atendiente humano (handoff)" value={form.handoff_agent_name} onChange={(v) => set('handoff_agent_name', v)} placeholder="Nombre del agente" />

          {/* ═══ FLUJO INICIAL (solo modo conversacional) ═══ */}
          {form.type === 'conversational_ai' && (
            <div style={{ background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)' }}
              className="rounded-xl p-4">
              <FlowStepsBuilder
                steps={flowSteps}
                onChange={setFlowSteps}
                onInsertVar={(v) => insertAtCursor(v)}
              />
            </div>
          )}

          {/* ═══ FLUJOS DE CONVERSIÓN ═══ */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            className="rounded-xl p-4">
            <ConversionFlowEditor
              flowId={flow?.id ?? null}
              conversions={conversions}
              onChange={setConversions}
            />
          </div>

          {/* ═══ INACTIVIDAD ═══ */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            className="rounded-xl p-4">
            <InactivityRulesEditor
              rules={inactRules}
              onChange={setInactRules}
            />
          </div>
        </div>

        {/* Footer */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            className="mx-6 mb-2 rounded-xl px-4 py-2.5 text-xs text-red-400">
            {error}
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          className="flex gap-2 px-6 py-4 shrink-0">
          <button onClick={onClose}
            style={{ border: '1px solid rgba(255,255,255,0.10)' }}
            className="flex-1 rounded-xl py-2.5 text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ background: saving ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all">
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear flujo'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── helpers UI ───────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" />
    </div>
  )
}
