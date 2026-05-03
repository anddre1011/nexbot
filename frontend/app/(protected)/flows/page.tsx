'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
type FlowType  = 'ai' | 'conversational_ai'
type ModelType = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1'
type ItemType  = 'text' | 'image' | 'video'

interface WelcomeItem        { id: string; type: ItemType; content: string }
interface InactivityMessage  { id: string; delay: number; unit: 'minutes' | 'hours'; message: string }

interface Flow {
  id:                  string
  name:                string
  type:                FlowType
  model:               ModelType
  system_prompt:       string | null
  handoff_agent_name:  string | null
  welcome_items:       WelcomeItem[]
  inactivity_messages: InactivityMessage[]
  executions:          number
  active:              boolean
  created_at:          string
}

// ─── constantes ───────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<FlowType, string> = {
  ai:                'IA',
  conversational_ai: 'Conversacional + IA',
}

const TYPE_COLOR: Record<FlowType, string> = {
  ai:                'bg-violet-500/15 text-violet-300',
  conversational_ai: 'bg-sky-500/15 text-sky-300',
}

const MODEL_LABELS: Record<ModelType, string> = {
  'gpt-4o':      'GPT-4o',
  'gpt-4o-mini': 'GPT-4o-mini',
  'gpt-4.1':     'GPT-4.1',
}

const VARIABLES = ['{{product_name}}', '{{price}}', '{{payment_methods}}']

const DEFAULT_PROMPT = `Eres un asistente de ventas de {{product_name}} por WhatsApp.
Tu objetivo es responder dudas sobre el producto y cerrar la venta.

Producto: {{product_name}}
Precio: {{price}}
Métodos de pago: {{payment_methods}}

Reglas:
- Respuestas cortas, máximo 3 oraciones.
- Indica el precio cuando el cliente pregunte.
- Si el cliente quiere pagar, explica los métodos de pago.`

function uid() { return Math.random().toString(36).slice(2, 10) }

// ─── página principal ─────────────────────────────────────────────────────────
export default function FlowsPage() {
  const [flows,   setFlows]   = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState<'create' | Flow | null>(null)

  const fetchFlows = useCallback(async () => {
    setLoading(true)
    try { setFlows(await apiFetch<Flow[]>('/api/flows')) }
    catch (err) { console.error('[flows]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchFlows() }, [fetchFlows])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este flujo?')) return
    await apiFetch(`/api/flows/${id}`, { method: 'DELETE' })
    setFlows((prev) => prev.filter((f) => f.id !== id))
  }

  async function toggleActive(flow: Flow) {
    const next = !flow.active
    setFlows((prev) => prev.map((f) => f.id === flow.id ? { ...f, active: next } : f))
    apiFetch(`/api/flows/${flow.id}`, { method: 'PATCH', body: JSON.stringify({ active: next }) })
      .catch(() => fetchFlows())
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-4">
            <h1 className="text-xl font-bold text-gray-100">Constructor IA</h1>
            <span className="text-sm text-gray-500">{loading ? '…' : flows.length} flujos</span>
          </div>
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Crear
          </button>
        </div>
      </div>

      {/* ── tabla ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="py-16 text-center text-sm text-gray-600">Cargando flujos...</p>
        ) : flows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-24">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
              <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.7-1.414 2.7H4.213c-1.444 0-2.414-1.7-1.414-2.7L4.2 15.3" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Sin flujos aún</p>
            <button onClick={() => setModal('create')}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              Crear primer flujo
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#141414] text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-6 py-3">Nombre</th>
                <th className="px-6 py-3">Tipo</th>
                <th className="px-6 py-3">Modelo</th>
                <th className="px-6 py-3 text-right">Ejecuciones</th>
                <th className="px-6 py-3 text-center">Activo</th>
                <th className="px-6 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {flows.map((flow) => (
                <tr key={flow.id}
                  className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors">

                  {/* nombre */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.7-1.414 2.7H4.213c-1.444 0-2.414-1.7-1.414-2.7L4.2 15.3" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-gray-100">{flow.name}</p>
                        {flow.handoff_agent_name && (
                          <p className="text-[10px] text-gray-500">→ {flow.handoff_agent_name}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-3">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${TYPE_COLOR[flow.type]}`}>
                      {TYPE_LABEL[flow.type]}
                    </span>
                  </td>

                  <td className="px-6 py-3 text-xs text-gray-400">
                    {MODEL_LABELS[flow.model]}
                  </td>

                  <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">
                    {flow.executions.toLocaleString()}
                  </td>

                  <td className="px-6 py-3 text-center">
                    <button onClick={() => toggleActive(flow)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${flow.active ? 'bg-indigo-600' : 'bg-white/10'}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${flow.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>

                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal(flow)}
                        className="rounded p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(flow.id)}
                        className="rounded p-1.5 text-gray-600 hover:bg-red-500/10 hover:text-red-400">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <FlowModal
          flow={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={fetchFlows}
        />
      )}
    </div>
  )
}

// ─── modal ────────────────────────────────────────────────────────────────────
function FlowModal({
  flow, onClose, onSaved,
}: { flow: Flow | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!flow

  type ModalTab = 'ai' | 'conversational_ai'
  const [tab,          setTab]          = useState<ModalTab>(flow?.type ?? 'ai')
  const [name,         setName]         = useState(flow?.name                ?? '')
  const [model,        setModel]        = useState<ModelType>(flow?.model   ?? 'gpt-4o')
  const [prompt,       setPrompt]       = useState(flow?.system_prompt      ?? DEFAULT_PROMPT)
  const [handoff,      setHandoff]      = useState(flow?.handoff_agent_name ?? '')
  const [welcomeItems, setWelcomeItems] = useState<WelcomeItem[]>(flow?.welcome_items ?? [])
  const [inactivity,   setInactivity]   = useState<InactivityMessage[]>(flow?.inactivity_messages ?? [])
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  // ── welcome items ────────────────────────────────────────────────────────────
  function addWelcomeItem(type: ItemType) {
    setWelcomeItems((prev) => [...prev, { id: uid(), type, content: '' }])
  }
  function updateWelcomeItem(id: string, content: string) {
    setWelcomeItems((prev) => prev.map((i) => i.id === id ? { ...i, content } : i))
  }
  function removeWelcomeItem(id: string) {
    setWelcomeItems((prev) => prev.filter((i) => i.id !== id))
  }

  // ── inactivity ───────────────────────────────────────────────────────────────
  function addInactivity() {
    setInactivity((prev) => [...prev, { id: uid(), delay: 60, unit: 'minutes', message: '' }])
  }
  function updateInactivity<K extends keyof InactivityMessage>(id: string, key: K, val: InactivityMessage[K]) {
    setInactivity((prev) => prev.map((i) => i.id === id ? { ...i, [key]: val } : i))
  }
  function removeInactivity(id: string) {
    setInactivity((prev) => prev.filter((i) => i.id !== id))
  }

  // ── submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setLoading(true); setError('')

    const body = {
      name: name.trim(), type: tab, model,
      system_prompt:       prompt.trim()  || null,
      handoff_agent_name:  handoff.trim() || null,
      welcome_items:       welcomeItems,
      inactivity_messages: inactivity,
    }

    try {
      if (isEdit) {
        await apiFetch(`/api/flows/${flow!.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/api/flows', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-8 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[#1a1a1a] shadow-2xl ring-1 ring-white/10">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? 'Editar flujo' : 'Crear flujo'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 pt-5 pb-6 flex flex-col gap-6">

            {/* ── tipo (tabs) ── */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400">Tipo de flujo</label>
              <div className="flex rounded-xl bg-white/5 p-1">
                {(['ai', 'conversational_ai'] as ModalTab[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)}
                    className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                      tab === t ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
                    }`}>
                    {t === 'ai' ? '🤖 IA' : '💬 Conversacional + IA'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── nombre ── */}
            <MField label="Nombre del flujo" required>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Flujo de ventas principal" className="modal-input" />
            </MField>

            {/* ── flujo inicial ── */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">Flujo inicial</label>
                <div className="flex gap-1.5">
                  {(['text', 'image', 'video'] as ItemType[]).map((t) => (
                    <button key={t} type="button" onClick={() => addWelcomeItem(t)}
                      className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-400 hover:bg-white/5">
                      {t === 'text' ? '✏️' : t === 'image' ? '🖼️' : '🎬'} {t}
                    </button>
                  ))}
                </div>
              </div>

              {welcomeItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-gray-600">
                  Añade mensajes de bienvenida con los botones de arriba
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {welcomeItems.map((item, i) => (
                    <div key={item.id} className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
                      <span className="mt-0.5 shrink-0 text-xs text-gray-500 w-4">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.type === 'text'  ? 'bg-blue-500/15 text-blue-300' :
                            item.type === 'image' ? 'bg-emerald-500/15 text-emerald-300' :
                                                    'bg-orange-500/15 text-orange-300'
                          }`}>
                            {item.type === 'text' ? '✏️ Texto' : item.type === 'image' ? '🖼️ Imagen' : '🎬 Video'}
                          </span>
                        </div>
                        {item.type === 'text' ? (
                          <textarea rows={2} value={item.content}
                            onChange={(e) => updateWelcomeItem(item.id, e.target.value)}
                            placeholder="Escribe el mensaje de bienvenida..."
                            className="modal-input resize-none text-xs" />
                        ) : (
                          <input value={item.content}
                            onChange={(e) => updateWelcomeItem(item.id, e.target.value)}
                            placeholder={item.type === 'image' ? 'URL de la imagen...' : 'URL del video...'}
                            className="modal-input text-xs" />
                        )}
                      </div>
                      <button type="button" onClick={() => removeWelcomeItem(item.id)}
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

            {/* ── modelo ── */}
            <div className="grid grid-cols-2 gap-4">
              <MField label="Modelo de IA">
                <select value={model} onChange={(e) => setModel(e.target.value as ModelType)}
                  className="modal-input">
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o-mini (económico)</option>
                  <option value="gpt-4.1">GPT-4.1</option>
                </select>
              </MField>
              <MField label="Atendiente humano (handoff)">
                <input value={handoff} onChange={(e) => setHandoff(e.target.value)}
                  placeholder="Nombre del agente..." className="modal-input" />
              </MField>
            </div>

            {/* ── prompt ── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">Prompt del agente</label>
                <div className="flex gap-1">
                  {VARIABLES.map((v) => (
                    <button key={v} type="button"
                      onClick={() => setPrompt((p) => p + ' ' + v)}
                      className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-500/25">
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <textarea rows={8} value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="modal-input resize-none font-mono text-xs leading-relaxed" />
            </div>

            {/* ── inactividad ── */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">Mensajes de recuperación por inactividad</label>
                <button type="button" onClick={addInactivity}
                  className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-400 hover:bg-white/5">
                  + Adicionar
                </button>
              </div>

              {inactivity.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-5 text-center text-xs text-gray-600">
                  Sin mensajes de recuperación
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {inactivity.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input type="number" min="1" value={item.delay}
                          onChange={(e) => updateInactivity(item.id, 'delay', Number(e.target.value))}
                          className="modal-input w-16 text-center text-xs" />
                        <select value={item.unit}
                          onChange={(e) => updateInactivity(item.id, 'unit', e.target.value as 'minutes' | 'hours')}
                          className="modal-input w-24 text-xs">
                          <option value="minutes">min</option>
                          <option value="hours">horas</option>
                        </select>
                      </div>
                      <input value={item.message}
                        onChange={(e) => updateInactivity(item.id, 'message', e.target.value)}
                        placeholder="Mensaje de recuperación..."
                        className="modal-input flex-1 text-xs" />
                      <button type="button" onClick={() => removeInactivity(item.id)}
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

          {error && (
            <p className="mx-6 mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2 border-t border-white/5 px-6 py-4">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-gray-400 hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear flujo'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
