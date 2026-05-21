'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { optimizeUploadFile } from '@/lib/media-compress'

interface Product { id: string; name: string; price: number; currency: string; delivery_url: string | null }
type DeliveryStepType = 'text' | 'image' | 'video' | 'audio' | 'document'
interface DeliveryStep {
  id: string
  type: DeliveryStepType
  content: string | null
  media_url: string | null
}
interface ConversionConfig {
  id: string; function_name: string; product_id: string | null; kanban_stage: string
  disable_ai: boolean; delivery_enabled: boolean; confirm_message: string | null
  confirm_steps?: DeliveryStep[]
  products?: Product | null
}

const KANBAN_STAGES = [
  { id: 'converted',    label: 'Convertido',    color: 'text-emerald-400' },
  { id: 'attending',    label: 'En Atención',   color: 'text-blue-400' },
  { id: 'human',        label: 'Atención Humana', color: 'text-orange-400' },
  { id: 'disqualified', label: 'Descalificado', color: 'text-red-400' },
]

export default function ConversionFlowEditor({ flowId, conversions, onChange }: {
  flowId: string | null
  conversions: ConversionConfig[]
  onChange: (c: ConversionConfig[]) => void
}) {
  const [products, setProducts] = useState<Product[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newFn, setNewFn] = useState('conversion')

  useEffect(() => {
    apiFetch<Product[]>('/api/products').then(setProducts).catch(() => {})
  }, [])

  function addConversion() {
    if (!newFn.trim()) return
    const item: ConversionConfig = {
      id: Math.random().toString(36).slice(2, 8),
      function_name: newFn.trim(),
      product_id: null, kanban_stage: 'converted',
      disable_ai: true, delivery_enabled: true, confirm_message: '', confirm_steps: [],
    }
    onChange([...conversions, item])
    setShowAdd(false)
    setNewFn('conversion' + (conversions.length + 1))

    if (flowId) {
      apiFetch(`/api/flows/${flowId}/conversions`, {
        method: 'POST', body: JSON.stringify(item),
      }).catch(() => {})
    }
  }

  function update(idx: number, patch: Partial<ConversionConfig>) {
    onChange(conversions.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  function mediaTypeFromFile(file: File): DeliveryStepType {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    return 'document'
  }

  async function uploadDeliveryFile(idx: number, file: File) {
    const uploadFile = await optimizeUploadFile(file)
    const fd = new FormData()
    fd.append('file', uploadFile)
    const { url } = await apiFetch<{ url: string }>('/api/upload/flow-media', {
      method: 'POST',
      body: fd,
      rawBody: true,
    } as Parameters<typeof apiFetch>[1])

    const conv = conversions[idx]
    const steps = [...(conv.confirm_steps ?? []), {
      id: crypto.randomUUID(),
      type: mediaTypeFromFile(uploadFile),
      content: uploadFile.name,
      media_url: url,
    }]
    update(idx, { confirm_steps: steps })
  }

  function removeDeliveryStep(idx: number, stepId: string) {
    const conv = conversions[idx]
    update(idx, { confirm_steps: (conv.confirm_steps ?? []).filter((step) => step.id !== stepId) })
  }

  function remove(idx: number) {
    const c = conversions[idx]
    onChange(conversions.filter((_, i) => i !== idx))
    if (flowId && c.id.length > 8) {
      apiFetch(`/api/flows/${flowId}/conversions/${c.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">
        Flujos de conversión
      </label>
      <p className="mb-3 text-[10px] text-gray-600">
        Se ejecutan cuando la IA detecta <code className="text-amber-300">{'{{function:nombre}}'}</code> en su respuesta
      </p>

      <div className="flex flex-col gap-3">
        {conversions.map((conv, idx) => (
          <div key={conv.id}
            style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}
            className="rounded-xl p-4">

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-sm">⚡</span>
                <code className="text-xs font-mono text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded">
                  {'{{function:' + conv.function_name + '}}'}
                </code>
              </div>
              <button onClick={() => remove(idx)} className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Confirm message */}
            <textarea rows={2} value={conv.confirm_message ?? ''}
              onChange={(e) => update(idx, { confirm_message: e.target.value })}
              placeholder="¡Muchas felicidades, fiera! 🎉 Tu pago ha sido verificado correctamente."
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none resize-none mb-3 focus:border-emerald-500 transition-all" />

            {/* Product selector */}
            <div className="mb-3">
              <label className="text-[10px] font-semibold text-gray-500 mb-1 block">Vincular Producto</label>
              <select value={conv.product_id ?? ''}
                onChange={(e) => update(idx, { product_id: e.target.value || null })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 outline-none">
                <option value="" className="bg-[#1a1a1a]">Sin producto</option>
                {products.map(p => (
                  <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                    {p.name} — {p.currency} {p.price}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="text-[10px] font-semibold text-gray-500 mb-1 block">Archivos de entrega</label>
              <div className="flex flex-col gap-2">
                {(conv.confirm_steps ?? []).map((step) => (
                  <div key={step.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300">
                      {step.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300">
                      {step.content || step.media_url}
                    </span>
                    <button
                      onClick={() => removeDeliveryStep(idx, step.id)}
                      className="text-xs text-gray-500 hover:text-red-400"
                    >
                      quitar
                    </button>
                  </div>
                ))}
                <input
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    uploadDeliveryFile(idx, file).catch(() => alert('Error al subir archivo'))
                    e.currentTarget.value = ''
                  }}
                  className="block w-full cursor-pointer rounded-lg border border-dashed border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-emerald-600 file:px-2 file:py-1 file:text-[11px] file:font-bold file:text-white hover:border-emerald-500/40"
                />
              </div>
            </div>

            {/* Kanban stage */}
            <div className="mb-3">
              <label className="text-[10px] font-semibold text-gray-500 mb-1 block">Mover a Kanban</label>
              <select value={conv.kanban_stage}
                onChange={(e) => update(idx, { kanban_stage: e.target.value })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 outline-none">
                {KANBAN_STAGES.map(s => (
                  <option key={s.id} value={s.id} className="bg-[#1a1a1a]">{s.label}</option>
                ))}
              </select>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">Entregar producto automáticamente</span>
                <button onClick={() => update(idx, { delivery_enabled: !conv.delivery_enabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${conv.delivery_enabled ? 'bg-emerald-600' : 'bg-white/10'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${conv.delivery_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </label>
              <label className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">Desactivar IA (ahorra tokens)</span>
                <button onClick={() => update(idx, { disable_ai: !conv.disable_ai })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${conv.disable_ai ? 'bg-red-600' : 'bg-white/10'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${conv.disable_ai ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </label>
            </div>
          </div>
        ))}

        {/* Add conversion */}
        {showAdd ? (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="rounded-xl p-3 flex gap-2">
            <input value={newFn} onChange={(e) => setNewFn(e.target.value)}
              placeholder="nombre_funcion"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              className="flex-1 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 outline-none" />
            <button onClick={addConversion}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Crear
            </button>
            <button onClick={() => setShowAdd(false)}
              className="rounded-lg px-3 py-2 text-xs text-gray-500 hover:text-gray-300">
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)}
            style={{ border: '2px dashed rgba(16,185,129,0.2)' }}
            className="w-full rounded-xl py-2.5 text-xs text-emerald-400/60 hover:text-emerald-300 hover:border-emerald-500/30 transition-all">
            + Agregar función de conversión
          </button>
        )}
      </div>
    </div>
  )
}
