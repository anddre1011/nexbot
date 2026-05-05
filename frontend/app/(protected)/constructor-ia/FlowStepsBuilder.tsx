'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'

interface FlowStep {
  id: string; position: number; type: string; content: string | null
  media_url: string | null; delay_ms: number; buttons: unknown[]
}

const STEP_TYPES = [
  { type: 'text',    icon: '💬', label: 'Texto' },
  { type: 'image',   icon: '🖼️', label: 'Imagen' },
  { type: 'video',   icon: '🎬', label: 'Video' },
  { type: 'audio',   icon: '🔊', label: 'Audio' },
  { type: 'file',    icon: '📎', label: 'Archivo' },
  { type: 'delay',   icon: '⏱️', label: 'Delay' },
]

export default function FlowStepsBuilder({ flowId, steps, onChange }: {
  flowId: string | null; steps: FlowStep[]; onChange: (s: FlowStep[]) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  async function addStep(type: string) {
    setShowMenu(false)
    const newStep: FlowStep = {
      id: Math.random().toString(36).slice(2, 8),
      position: steps.length,
      type,
      content: type === 'delay' ? null : '',
      media_url: null,
      delay_ms: type === 'delay' ? 2000 : 0,
      buttons: [],
    }
    const updated = [...steps, newStep]
    onChange(updated)

    if (flowId) {
      try {
        const saved = await apiFetch<FlowStep>(`/api/flows/${flowId}/steps`, {
          method: 'POST', body: JSON.stringify({ type, position: newStep.position, delay_ms: newStep.delay_ms }),
        })
        onChange(updated.map(s => s.id === newStep.id ? saved : s))
      } catch { /* local only until save */ }
    }
  }

  function updateStep(idx: number, patch: Partial<FlowStep>) {
    const updated = steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
    onChange(updated)
  }

  function removeStep(idx: number) {
    onChange(steps.filter((_, i) => i !== idx))
    if (flowId && steps[idx]?.id?.length > 8) {
      apiFetch(`/api/flows/${flowId}/steps/${steps[idx].id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  function handleDragStart(idx: number) { setDragIdx(idx) }
  function handleDragOver(e: React.DragEvent) { e.preventDefault() }
  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return }
    const reordered = [...steps]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(targetIdx, 0, moved)
    onChange(reordered.map((s, i) => ({ ...s, position: i })))
    setDragIdx(null)
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">
        Flujo inicial
      </label>
      <p className="mb-3 text-[10px] text-gray-600">
        Secuencia de mensajes que se envían automáticamente al primer contacto
      </p>

      {/* Steps list */}
      <div className="flex flex-col gap-2 mb-3">
        {steps.map((step, idx) => (
          <div key={step.id}
            draggable onDragStart={() => handleDragStart(idx)}
            onDragOver={handleDragOver} onDrop={() => handleDrop(idx)}
            style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${dragIdx === idx ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.07)'}` }}
            className="rounded-xl p-3 transition-all">

            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="cursor-grab text-gray-600 hover:text-gray-400">⋮⋮</span>
              <span className="text-sm">{STEP_TYPES.find(t => t.type === step.type)?.icon ?? '📦'}</span>
              <span className="text-xs font-semibold text-gray-300 capitalize">{step.type === 'delay' ? 'Atraso' : step.type}</span>
              <span className="text-[10px] text-gray-600 ml-auto">#{idx + 1}</span>
              <button onClick={() => removeStep(idx)} className="ml-1 text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Content based on type */}
            {step.type === 'text' && (
              <textarea rows={2} value={step.content ?? ''}
                onChange={(e) => updateStep(idx, { content: e.target.value })}
                placeholder="Escribe tu mensaje..."
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none resize-none focus:border-violet-500 transition-all" />
            )}

            {(step.type === 'image' || step.type === 'video' || step.type === 'audio' || step.type === 'file') && (
              <div className="flex flex-col gap-2">
                <input value={step.media_url ?? ''}
                  onChange={(e) => updateStep(idx, { media_url: e.target.value })}
                  placeholder="URL del archivo (Supabase Storage)"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                  className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500 transition-all" />
                {(step.type === 'image' || step.type === 'video') && (
                  <input value={step.content ?? ''}
                    onChange={(e) => updateStep(idx, { content: e.target.value })}
                    placeholder="Caption (opcional)"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                    className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500 transition-all" />
                )}
              </div>
            )}

            {step.type === 'delay' && (
              <div className="flex items-center gap-3">
                <input type="range" min={500} max={30000} step={500}
                  value={step.delay_ms}
                  onChange={(e) => updateStep(idx, { delay_ms: Number(e.target.value) })}
                  className="flex-1 accent-violet-500" />
                <span className="text-xs font-mono text-violet-300 w-12 text-right">
                  {step.delay_ms >= 1000 ? `${(step.delay_ms / 1000).toFixed(1)}s` : `${step.delay_ms}ms`}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      <div className="relative">
        <button onClick={() => setShowMenu(!showMenu)}
          style={{ background: 'rgba(255,255,255,0.03)', border: '2px dashed rgba(255,255,255,0.08)' }}
          className="w-full rounded-xl py-3 text-sm text-gray-500 hover:text-gray-300 hover:border-violet-500/30 transition-all flex items-center justify-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Adicionar Item
        </button>

        {showMenu && (
          <div style={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            className="absolute left-0 right-0 top-12 z-20 rounded-xl p-1.5 grid grid-cols-3 gap-1">
            {STEP_TYPES.map(({ type, icon, label }) => (
              <button key={type} onClick={() => addStep(type)}
                className="flex flex-col items-center gap-1 rounded-lg px-3 py-2.5 text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
                <span className="text-lg">{icon}</span>
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
