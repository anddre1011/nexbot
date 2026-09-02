'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { optimizeUploadFile } from '@/lib/media-compress'
import FlowStepsBuilder from './FlowStepsBuilder'
import ConversionFlowEditor from './ConversionFlowEditor'
import InactivityRulesEditor from './InactivityRulesEditor'

// ─── tipos ────────────────────────────────────────────────────────────────────
type FlowType  = 'ai' | 'conversational_ai'
type ModelId   = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1' | 'gpt-3.5-turbo' | 'deepseek-v4-pro' | 'deepseek-v4-flash' | 'deepseek-chat' | 'deepseek-reasoner' | 'hybrid-deepseek-gpt4o' | 'hybrid-deepseek-pro-gpt4o'
const AGENT_DISABLED_TAG = 'agent_disabled'
const CHAT_COLOR_TAG_PREFIX = 'chat_color:'

const CHAT_COLOR_OPTIONS = [
  { id: 'violet',  label: 'Morado',  hex: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.38)' },
  { id: 'emerald', label: 'Verde',   hex: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.38)' },
  { id: 'sky',     label: 'Azul',    hex: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.38)' },
  { id: 'amber',   label: 'Amarillo', hex: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.38)' },
  { id: 'rose',    label: 'Rojo',    hex: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.38)' },
  { id: 'cyan',    label: 'Cyan',    hex: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.38)' },
] as const

function getFlowChatColor(tags?: string[] | null) {
  const tag = tags?.find((item) => item.startsWith(CHAT_COLOR_TAG_PREFIX))
  const color = tag ? tag.slice(CHAT_COLOR_TAG_PREFIX.length) : ''
  return CHAT_COLOR_OPTIONS.some((item) => item.id === color) ? color : 'violet'
}

function getFlowChatColorOption(tags?: string[] | null) {
  return CHAT_COLOR_OPTIONS.find((item) => item.id === getFlowChatColor(tags)) ?? CHAT_COLOR_OPTIONS[0]
}

function setFlowChatColorTag(tags: string[], color: string) {
  return [...tags.filter((tag) => !tag.startsWith(CHAT_COLOR_TAG_PREFIX)), `${CHAT_COLOR_TAG_PREFIX}${color}`]
}

interface WelcomeItem       { id: string; type: 'text' | 'image' | 'video'; content: string }
interface InactivityMsg     { id: string; delay: number; unit: 'minutes' | 'hours'; message: string }
interface MediaItem         { id: string; name: string; variable: string | null; type?: string; url?: string }

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
  tags?:                 string[] | null
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
  agent_enabled:       boolean
  chat_color:          string
  tags:                string[]
}

const MODELS: { id: ModelId; label: string; desc: string; badge?: string }[] = [
  { id: 'hybrid-deepseek-gpt4o',     label: 'Ahorrador Flash + GPT-4o', desc: 'DeepSeek para texto + GPT-4o solo para comprobantes/imágenes', badge: '💸 Ahorrador' },
  { id: 'hybrid-deepseek-pro-gpt4o', label: 'Ahorrador Pro + GPT-4o',   desc: 'DeepSeek Pro para ventas + GPT-4o solo para comprobantes/imágenes', badge: '💸 Pro' },
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
  name: '', type: 'conversational_ai', model: 'gpt-4o', system_prompt: DEFAULT_PROMPT,
  handoff_agent_name: '', welcome_items: [], inactivity_messages: [],
  conversion_enabled: false, conversion_message: '', inactivity_delay: '60', inactivity_unit: 'minutes',
  agent_enabled: true, chat_color: 'violet', tags: [],
}

function buildFormState(flow: Flow | null): FormState {
  if (!flow) {
    return {
      ...EMPTY,
      welcome_items: [],
      inactivity_messages: [],
      tags: [],
    }
  }

  return {
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
    agent_enabled:       !(flow.tags ?? []).includes(AGENT_DISABLED_TAG),
    chat_color:          getFlowChatColor(flow.tags),
    tags:                flow.tags ?? [],
  }
}

function normalizeMediaToken(value: string) {
  return value.replace(/\s+/g, '')
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
    <div className="relative flex h-[100dvh] overflow-hidden bg-[#0a0a0f]">

      {/* ── lista principal ── */}
      <div className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ${panelOpen ? 'lg:mr-[620px]' : ''}`}>

        {/* ── Top bar ── */}
        <div style={{ background: '#0d0d14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          className="shrink-0 flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 sm:px-4">
            <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input placeholder="Buscar flujos..." className="min-w-0 flex-1 bg-transparent text-sm text-gray-400 placeholder-gray-600 outline-none" />
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <button onClick={() => setPanel('new')}
            style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shrink-0 sm:px-4">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Crear Flujo</span>
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-auto p-3 space-y-5 sm:p-6 sm:space-y-6">
          {/* Header + stats */}
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">Constructor IA</h1>
            <p className="mt-1 text-sm text-gray-500">Gestiona y automatiza tus flujos de conversación con inteligencia artificial.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Flujos Activos',      value: loading ? '–' : String(flows.filter(f => f.active).length),                               icon: '🤖', glow: 'rgba(124,58,237,0.15)' },
              { label: 'Ejecuciones hoy',     value: loading ? '–' : flows.reduce((a, f) => a + (f.executions ?? 0), 0).toLocaleString(),      icon: '⚡', glow: 'rgba(37,99,235,0.15)'  },
              { label: 'Conversión Promedio', value: '–',                                                                                        icon: '📈', glow: 'rgba(16,185,129,0.15)' },
              { label: 'Tokens Usados',       value: '–',                                                                                        icon: '🔢', glow: 'rgba(245,158,11,0.15)'  },
            ].map(s => (
              <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: `0 4px 24px ${s.glow}` }}
                className="rounded-2xl p-3 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{s.label}</span>
                  <span className="text-lg">{s.icon}</span>
                </div>
                <p className={`text-xl font-extrabold text-white sm:text-2xl ${loading ? 'animate-pulse' : ''}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Flows section */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-white">Tus Flujos</h2>
              <div className="flex gap-1">
                <button style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(37,99,235,0.12))', border: '1px solid rgba(124,58,237,0.3)' }}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-violet-300">Recientes</button>
                <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors">Categorías</button>
              </div>
            </div>

          {loading ? (
            <div className="flex items-center gap-3 py-8 text-sm text-gray-600">
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
                  className="flex flex-col gap-3 rounded-2xl p-4 transition-all hover:bg-white/[0.04] cursor-pointer sm:flex-row sm:items-center sm:gap-4 sm:p-5"
                  onClick={() => setPanel(flow)}>

                  {/* Icono */}
                  <div style={{ background: flow.active ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)', border: `1px solid ${flow.active ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.08)'}` }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                    <svg className={`h-5 w-5 ${flow.active ? 'text-violet-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-100">{flow.name}</p>
                      <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                        className="rounded-full px-2 py-0.5 text-[10px] font-mono text-gray-500">
                        {flow.model}
                      </span>
                      <span
                        style={{
                          background: getFlowChatColorOption(flow.tags).bg,
                          border: `1px solid ${getFlowChatColorOption(flow.tags).border}`,
                          color: getFlowChatColorOption(flow.tags).hex,
                        }}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: getFlowChatColorOption(flow.tags).hex }} />
                        Chat
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
                  <div className="flex w-full items-center justify-end gap-2 shrink-0 sm:w-auto" onClick={(e) => e.stopPropagation()}>
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
          </div>{/* end flows section */}

          {/* Feature cards decorativas */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div style={{ background: 'linear-gradient(135deg, #1a0a2e 0%, #0d1a3a 100%)', border: '1px solid rgba(124,58,237,0.2)', minHeight: '140px' }}
              className="relative rounded-2xl p-6 overflow-hidden flex flex-col justify-end cursor-pointer hover:opacity-90 transition-all">
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, #7c3aed 0%, transparent 60%)' }} />
              <p className="relative text-base font-bold text-white">Motor Cognitivo v2</p>
              <p className="relative text-xs text-gray-400 mt-0.5">Optimizado para WhatsApp</p>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #0a1a0d 0%, #0d2a18 100%)', border: '1px solid rgba(16,185,129,0.2)', minHeight: '140px' }}
              className="relative rounded-2xl p-6 overflow-hidden flex flex-col justify-end cursor-pointer hover:opacity-90 transition-all">
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, #10b981 0%, transparent 60%)' }} />
              <p className="relative text-base font-bold text-white">Lógica de Conversión</p>
              <p className="relative text-xs text-gray-400 mt-0.5">Modelos DeepSeek Integrados</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── panel lateral deslizante ── */}
      {panelOpen && (
        <FlowPanel
          flow={typeof panel === 'object' ? panel : null}
          medias={medias}
          onClose={() => setPanel('closed')}
          onSaved={() => { setPanel('closed'); fetchFlows() }}
          onMediaCreated={(media) => setMedias((prev) => [media, ...prev.filter((m) => m.id !== media.id)])}
        />
      )}
    </div>
  )
}

// ─── panel lateral ────────────────────────────────────────────────────────────
function FlowPanel({ flow, medias, onClose, onSaved, onMediaCreated }: {
  flow:     Flow | null
  medias:   MediaItem[]
  onClose:  () => void
  onSaved:  () => void
  onMediaCreated: (media: MediaItem) => void
}) {
  const isEdit = !!flow
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm]       = useState<FormState>(() => buildFormState(flow))
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState('')
  const [saveStatus,      setSaveStatus]      = useState('')
  const [saved,           setSaved]           = useState(false)
  const [generating,      setGenerating]      = useState(false)
  const [showMediaPicker,   setShowMediaPicker]   = useState(false)
  const [promptExpanded,    setPromptExpanded]    = useState(false)
  const [uploadingMedia,    setUploadingMedia]    = useState(false)
  const [pendingMedia,      setPendingMedia]      = useState<{url: string; varName: string; mediaType: 'image' | 'video' | 'audio'} | null>(null)
  const [uploadKey,         setUploadKey]         = useState(0)

  // ─── Estado de pasos, conversiones e inactividad ───────────────────────────
  const [flowSteps, setFlowSteps] = useState<any[]>([])
  const [conversions, setConversions] = useState<any[]>([])
  const [inactRules, setInactRules] = useState<any[]>([])

  useEffect(() => {
    setForm(buildFormState(flow))
    setSaving(false)
    setError('')
    setSaveStatus('')
    setSaved(false)
    setGenerating(false)
    setShowMediaPicker(false)
    setPromptExpanded(false)
    setUploadingMedia(false)
    setPendingMedia(null)
    setUploadKey((key) => key + 1)
  }, [flow?.id, isEdit])

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

  const promptMediaTokens = Array.from(new Set(
    (form.system_prompt.match(/\{\{\s*media:\s*[^}]+\s*\}\}/g) ?? []).map((token) => token.trim())
  ))
  const availableMediaTokens = new Set([
    ...medias.map((media) => media.variable).filter(Boolean).map((token) => normalizeMediaToken(token as string)),
    ...flowSteps
      .filter((step: any) => step.variable_name)
      .map((step: any) => normalizeMediaToken(`{{media:${step.variable_name}}}`)),
  ])

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
    setSaving(true); setSaved(false); setError(''); setSaveStatus('Guardando flujo...')
    const agentTags = form.agent_enabled
      ? form.tags.filter((tag) => tag !== AGENT_DISABLED_TAG)
      : Array.from(new Set([...form.tags, AGENT_DISABLED_TAG]))
    const nextTags = setFlowChatColorTag(agentTags, form.chat_color)
    const body = {
      name:               form.name.trim(),
      type:               flowSteps.length > 0 ? 'conversational_ai' : form.type,
      model:              form.model,
      system_prompt:      form.system_prompt || null,
      handoff_agent_name: form.handoff_agent_name || null,
      welcome_items:      [],
      inactivity_messages: [],
      conversion_enabled: conversions.length > 0,
      conversion_message: null,
      tags:               nextTags,
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
      setSaveStatus('Guardando mensajes, conversiones e inactividad...')
      await Promise.all([
        apiFetch(`/api/flows/${flowId}/steps`,            { method: 'PUT', body: JSON.stringify(flowSteps) }),
        apiFetch(`/api/flows/${flowId}/conversions`,       { method: 'PUT', body: JSON.stringify(conversions) }),
        apiFetch(`/api/flows/${flowId}/inactivity-rules`, { method: 'PUT', body: JSON.stringify(inactRules) }),
      ])
      setSaved(true)
      setSaveStatus('Guardado correctamente')
      setTimeout(onSaved, 650)
    } catch (err) {
      setSaveStatus('')
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div style={{ background: '#0d0d14', borderLeft: '1px solid rgba(255,255,255,0.07)', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)' }}
        className="fixed inset-x-0 bottom-0 top-0 z-40 flex h-full w-full flex-col sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[620px]">

        {/* Header */}
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          className="flex items-center justify-between px-4 py-4 shrink-0 sm:px-6">
          <h2 className="text-base font-bold text-white">{isEdit ? 'Editar flujo' : 'Nuevo flujo'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5 sm:px-6 sm:py-5">

          {/* Tabs tipo */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            className="flex gap-1 overflow-hidden rounded-xl p-1">
            {([['ai', '🤖 IA'], ['conversational_ai', '💬 Conversacional + IA']] as [FlowType, string][]).map(([t, l]) => (
              <button key={t} onClick={() => set('type', t)}
                style={form.type === t ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2))', border: '1px solid rgba(124,58,237,0.4)' } : {}}
                className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all sm:text-sm ${form.type === t ? 'text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Nombre */}
          <InputField label="Nombre del flujo" value={form.name} onChange={(v) => set('name', v)} placeholder="Flujo de ventas principal" required />

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Color en el chat</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {CHAT_COLOR_OPTIONS.map((color) => {
                const active = form.chat_color === color.id
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => set('chat_color', color.id)}
                    style={{
                      background: active ? color.bg : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? color.border : 'rgba(255,255,255,0.08)'}`,
                    }}
                    className="flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-gray-300 transition hover:bg-white/5"
                    aria-pressed={active}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ background: color.hex, boxShadow: active ? `0 0 14px ${color.hex}80` : undefined }}
                    />
                    <span className="truncate">{color.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

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

          <div
            style={{
              background: form.agent_enabled ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${form.agent_enabled ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.28)'}`,
            }}
            className="rounded-xl p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Agente IA</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  {form.agent_enabled
                    ? 'Activo: despues del flujo, la IA seguira respondiendo.'
                    : 'Apagado: solo se enviara el flujo inicial y el chat quedara abierto.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => set('agent_enabled', !form.agent_enabled)}
                aria-pressed={form.agent_enabled}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  form.agent_enabled ? 'bg-emerald-600' : 'bg-amber-500/70'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    form.agent_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Prompt editor */}
          <div className={form.agent_enabled ? '' : 'opacity-60'}>
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
              <div className="w-full sm:w-auto">
                <button onClick={() => setShowMediaPicker(p => !p)}
                  style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}
                  className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition-colors">
                  📁 Media
                </button>

                {showMediaPicker && (
                  <div style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 12px 40px rgba(0,0,0,0.8)' }}
                    className="relative z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl p-2 sm:w-96">

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
                            try {
                              const savedMedia = await apiFetch<MediaItem>('/api/media', {
                                method: 'POST',
                                body: JSON.stringify({ name: pendingMedia.varName, type: pendingMedia.mediaType, url: pendingMedia.url, variable: v }),
                              })
                              onMediaCreated(savedMedia)
                              set('system_prompt', (form.system_prompt ?? '') + '\n' + v)
                              setPendingMedia(null)
                              setShowMediaPicker(false)
                            } catch (err) {
                              alert('Error al guardar media: ' + (err instanceof Error ? err.message : 'desconocido'))
                            }
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
                              const uploadFile = await optimizeUploadFile(file)
                              const mediaType = uploadFile.type.startsWith('video/')
                                ? 'video'
                                : uploadFile.type.startsWith('audio/')
                                  ? 'audio'
                                  : 'image'
                              const short = `${mediaType}_${Date.now().toString().slice(-4)}`
                              // Solo subir a storage — no guardar en DB todavía (se guarda al confirmar nombre)
                              const { createClient } = await import('@/lib/supabase/client')
                              const { data: { session } } = await createClient().auth.getSession()
                              const token = session?.access_token ?? ''
                              const fd = new FormData(); fd.append('file', uploadFile)
                              const res = await fetch('https://nexbot.pro/api/upload/flow-media', {
                                method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` }
                              })
                              if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error ?? `Error ${res.status}`) }
                              const { url } = await res.json()
                              setPendingMedia({ url, varName: short, mediaType })
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

            <div>
              <textarea ref={promptRef}
                rows={promptExpanded ? 22 : 10}
                value={form.system_prompt}
                onChange={(e) => set('system_prompt', e.target.value)}
                spellCheck={false}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                className="w-full rounded-xl px-4 py-3 font-mono text-xs leading-relaxed text-gray-100 placeholder-gray-600 outline-none transition-all resize-y selection:bg-violet-500/35 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              />
              {promptMediaTokens.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {promptMediaTokens.map((token) => {
                    const isValid = availableMediaTokens.has(normalizeMediaToken(token))
                    return (
                      <span
                        key={token}
                        className={`rounded-lg px-2 py-1 font-mono text-[10px] font-bold ${
                          isValid
                            ? 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                            : 'border border-red-400/30 bg-red-400/15 text-red-300'
                        }`}
                        title={isValid ? 'Media encontrada' : 'No encuentro esta media guardada'}
                      >
                        {token}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Handoff */}
          <InputField label="Atendiente humano (handoff)" value={form.handoff_agent_name} onChange={(v) => set('handoff_agent_name', v)} placeholder="Nombre del agente" />

          {/* ═══ FLUJO INICIAL ═══ */}
          <div style={{ background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.20)', boxShadow: '0 0 28px rgba(124,58,237,0.08)' }}
              className="rounded-xl p-4 transition-all hover:border-violet-400/40 hover:shadow-[0_0_30px_rgba(124,58,237,0.16)]">
              <FlowStepsBuilder
                steps={flowSteps}
                onChange={setFlowSteps}
                onInsertVar={(v) => insertAtCursor(v)}
              />
          </div>

          {/* ═══ FLUJOS DE CONVERSIÓN ═══ */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(16,185,129,0.16)', boxShadow: '0 0 24px rgba(16,185,129,0.06)' }}
            className="rounded-xl p-4 transition-all hover:border-emerald-400/35 hover:shadow-[0_0_28px_rgba(16,185,129,0.14)]">
            <ConversionFlowEditor
              flowId={flow?.id ?? null}
              conversions={conversions}
              onChange={setConversions}
            />
          </div>

          {/* ═══ INACTIVIDAD ═══ */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(245,158,11,0.16)', boxShadow: '0 0 24px rgba(245,158,11,0.06)' }}
            className="rounded-xl p-4 transition-all hover:border-amber-400/35 hover:shadow-[0_0_28px_rgba(245,158,11,0.14)]">
            <InactivityRulesEditor
              rules={inactRules}
              onChange={setInactRules}
            />
          </div>
        </div>

        {/* Footer */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            className="mx-4 mb-2 rounded-xl px-4 py-2.5 text-xs text-red-400 sm:mx-6">
            {error}
          </div>
        )}
        {saveStatus && !error && (
          <div style={{ background: saved ? 'rgba(16,185,129,0.12)' : 'rgba(124,58,237,0.12)', border: saved ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(124,58,237,0.25)' }}
            className={`mx-4 mb-2 rounded-xl px-4 py-2.5 text-xs sm:mx-6 ${saved ? 'text-emerald-300' : 'text-violet-300'}`}>
            {saveStatus}
          </div>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          className="flex gap-2 px-4 py-3 shrink-0 sm:px-6 sm:py-4">
          <button onClick={onClose}
            style={{ border: '1px solid rgba(255,255,255,0.10)' }}
            className="flex-1 rounded-xl py-2.5 text-sm font-medium text-gray-400 hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || saved}
            style={{ background: saving || saved ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all">
            {saved ? 'Guardado' : saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear flujo'}
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
