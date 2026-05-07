'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'

export interface FlowStep {
  id: string
  position: number
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'delay' | 'wait_response'
  content: string | null
  media_url: string | null
  delay_ms: number
  buttons: unknown[]
}

const STEP_TYPES = [
  { type: 'text',          icon: '💬', label: 'Texto' },
  { type: 'image',         icon: '🖼️', label: 'Imagen' },
  { type: 'video',         icon: '🎬', label: 'Video' },
  { type: 'audio',         icon: '🔊', label: 'Audio' },
  { type: 'file',          icon: '📎', label: 'Archivo' },
  { type: 'delay',         icon: '⏱️', label: 'Delay' },
  { type: 'wait_response', icon: '⏳', label: 'Esperar resp.' },
] as const

const ACCEPT: Record<string, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file:  '*/*',
}

function uid() { return Math.random().toString(36).slice(2, 8) }

export default function FlowStepsBuilder({ steps, onChange }: {
  steps: FlowStep[]
  onChange: (s: FlowStep[]) => void
}) {
  const [showMenu,  setShowMenu]  = useState(false)
  const [dragIdx,   setDragIdx]   = useState<number | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)

  function addStep(type: FlowStep['type']) {
    setShowMenu(false)
    onChange([...steps, {
      id: uid(), position: steps.length, type,
      content: null, media_url: null,
      delay_ms: type === 'delay' ? 2000 : 0, buttons: [],
    }])
  }

  function update(idx: number, patch: Partial<FlowStep>) {
    onChange(steps.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  function remove(idx: number) {
    onChange(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i })))
  }

  async function handleFile(idx: number, file: File) {
    setUploading(steps[idx].id)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const data = await apiFetch<{ url: string }>('/api/upload/flow-media', {
        method: 'POST',
        body: fd,
        rawBody: true,
      } as Parameters<typeof apiFetch>[1])
      update(idx, { media_url: data.url })
    } catch (err) {
      console.error('[upload]', err)
      alert('Error al subir archivo. Verifica que el bucket "media" existe en Supabase Storage.')
    } finally { setUploading(null) }
  }

  // Drag & drop reorder
  function onDragStart(idx: number) { setDragIdx(idx) }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  function onDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return }
    const arr = [...steps]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(targetIdx, 0, moved)
    onChange(arr.map((s, i) => ({ ...s, position: i })))
    setDragIdx(null)
  }

  return (
    <div>
      <div className="mb-3">
        <label className="block text-xs font-bold uppercase tracking-widest text-gray-500">Flujo inicial</label>
        <p className="text-[10px] text-gray-600 mt-0.5">Secuencia de mensajes al primer contacto · arrastra para reordenar</p>
      </div>

      <div className="flex flex-col gap-2 mb-2">
        {steps.map((step, idx) => (
          <div key={step.id} draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={onDragOver}
            onDrop={() => onDrop(idx)}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              opacity: dragIdx === idx ? 0.4 : 1,
            }}
            className="rounded-xl p-3 transition-opacity">

            {/* Header */}
            <div className="flex items-center gap-2 mb-2 cursor-grab active:cursor-grabbing">
              <span className="text-gray-600 select-none text-sm">⠿</span>
              <span>{STEP_TYPES.find(t => t.type === step.type)?.icon}</span>
              <span className="text-xs font-semibold text-gray-300">
                {STEP_TYPES.find(t => t.type === step.type)?.label}
              </span>
              <span className="ml-auto text-[10px] text-gray-600">#{idx + 1}</span>
              <button onClick={() => remove(idx)}
                className="text-gray-600 hover:text-red-400 transition-colors p-0.5">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Contenido por tipo */}
            {step.type === 'text' && (
              <textarea rows={2} value={step.content ?? ''}
                onChange={e => update(idx, { content: e.target.value })}
                placeholder="Escribe tu mensaje..."
                className="modal-input resize-none text-xs w-full" />
            )}

            {step.type === 'delay' && (
              <div className="flex items-center gap-3">
                <input type="range" min={500} max={10000} step={500}
                  value={step.delay_ms}
                  onChange={e => update(idx, { delay_ms: Number(e.target.value) })}
                  className="flex-1 accent-violet-500" />
                <span className="text-xs text-violet-300 w-14 text-right font-mono">
                  {(step.delay_ms / 1000).toFixed(1)}s
                </span>
              </div>
            )}

            {step.type === 'wait_response' && (
              <p className="text-[10px] text-gray-500 italic">
                El bot espera la respuesta del contacto antes de continuar.
              </p>
            )}

            {['image', 'video', 'audio', 'file'].includes(step.type) && (
              <div className="flex flex-col gap-1.5">
                {step.media_url ? (
                  /* Archivo subido */
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <span className="text-emerald-400 text-sm">✓</span>
                    <span className="text-xs text-emerald-300 truncate flex-1">
                      {decodeURIComponent(step.media_url.split('/').pop() ?? '').slice(0, 45)}
                    </span>
                    <button onClick={() => update(idx, { media_url: null })}
                      className="text-gray-500 hover:text-red-400 shrink-0 transition-colors">
                      ✕
                    </button>
                  </div>
                ) : (
                  /* Botón de subida — usa <label> para garantizar apertura del file picker */
                  <label
                    style={{ background: uploading === step.id ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.1)', border: '1px dashed rgba(124,58,237,0.35)', cursor: uploading === step.id ? 'not-allowed' : 'pointer' }}
                    className="w-full rounded-xl py-3 text-center text-xs font-semibold text-violet-400 hover:bg-violet-500/20 transition-colors block">
                    {uploading === step.id
                      ? '⏳ Subiendo...'
                      : `📁 Subir ${STEP_TYPES.find(t => t.type === step.type)?.label}`}
                    <input
                      type="file"
                      className="hidden"
                      accept={ACCEPT[step.type] ?? '*/*'}
                      disabled={uploading === step.id}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleFile(idx, f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}

                {/* Caption solo para imagen/video */}
                {(step.type === 'image' || step.type === 'video') && (
                  <input value={step.content ?? ''}
                    onChange={e => update(idx, { content: e.target.value })}
                    placeholder="Caption (opcional)"
                    className="modal-input text-xs" />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Botón añadir */}
      <div className="relative">
        <button onClick={() => setShowMenu(p => !p)}
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)' }}
          className="w-full rounded-xl py-2.5 text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all">
          + Adicionar Item
        </button>

        {showMenu && (
          <div onClick={() => setShowMenu(false)}
            style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.8)' }}
            className="absolute bottom-full left-0 right-0 mb-1 rounded-xl p-2 z-20 grid grid-cols-4 gap-1">
            {STEP_TYPES.map(({ type, icon, label }) => (
              <button key={type}
                onClick={() => addStep(type as FlowStep['type'])}
                className="flex flex-col items-center gap-1 rounded-lg p-2.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors">
                <span className="text-xl">{icon}</span>
                <span className="text-[9px] text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
