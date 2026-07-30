'use client'
import { useState } from 'react'
import { uploadFlowMedia } from '@/lib/upload'

export interface FlowStep {
  id: string
  position: number
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'delay' | 'wait_response'
  content: string | null
  media_url: string | null
  variable_name: string | null   // {{media:variable_name}}
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

function toVarName(filename: string, position: number): string {
  // "FIFA World Cup 2026.jpg" → "fifa_world_cup_2026"
  const base = filename.split('/').pop()?.replace(/\.[^.]+$/, '') ?? `media_${position}`
  return base.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 25)
}

export default function FlowStepsBuilder({
  steps, onChange, onInsertVar,
}: {
  steps:        FlowStep[]
  onChange:     (s: FlowStep[]) => void
  onInsertVar?: (variable: string) => void
}) {
  const [showMenu,  setShowMenu]  = useState(false)
  const [dragIdx,   setDragIdx]   = useState<number | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [copied,    setCopied]    = useState<string | null>(null)

  function addStep(type: FlowStep['type']) {
    setShowMenu(false)
    onChange([...steps, {
      id: uid(), position: steps.length, type,
      content: null, media_url: null, variable_name: null,
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
    const step = steps[idx]
    setUploading(step.id)
    try {
      const result = await uploadFlowMedia(file, toVarName(file.name, idx))
      update(idx, { media_url: result.url, variable_name: result.varName })
    } catch (err) {
      console.error('[upload]', err)
      alert('Error al subir: ' + (err instanceof Error ? err.message : 'desconocido'))
    } finally { setUploading(null) }
  }

  function copyVar(varStr: string) {
    navigator.clipboard.writeText(varStr)
    setCopied(varStr)
    setTimeout(() => setCopied(null), 2000)
  }

  function copyText(id: string, text: string | null) {
    if (!text?.trim()) return
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
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
        <p className="text-[10px] text-gray-600 mt-0.5">Mensajes automáticos al primer contacto · arrastra para reordenar</p>
      </div>

      <div className="flex flex-col gap-2 mb-2">
        {steps.map((step, idx) => (
          <div key={step.id}
            onDragOver={onDragOver}
            onDrop={() => onDrop(idx)}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              opacity: dragIdx === idx ? 0.4 : 1,
            }}
            className="rounded-xl p-3 transition-opacity">

            {/* Header */}
            <div draggable
              onDragStart={() => onDragStart(idx)}
              className="flex items-center gap-2 mb-2 cursor-grab active:cursor-grabbing">
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

            {/* Texto */}
            {step.type === 'text' && (
              <div className="space-y-1.5">
                <textarea rows={3} value={step.content ?? ''}
                  draggable={false}
                  onChange={e => update(idx, { content: e.target.value })}
                  placeholder="Escribe tu mensaje..."
                  className="modal-input min-h-[92px] resize-y text-xs w-full leading-relaxed" />
                <button type="button"
                  onClick={() => copyText(`text:${step.id}`, step.content)}
                  className="rounded-lg px-2 py-1 text-[10px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                  {copied === `text:${step.id}` ? 'Copiado' : 'Copiar texto'}
                </button>
              </div>
            )}

            {/* Delay */}
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

            {/* Esperar respuesta */}
            {step.type === 'wait_response' && (
              <p className="text-[10px] text-gray-500 italic">
                El bot espera la respuesta del contacto antes de continuar.
              </p>
            )}

            {/* Media (imagen / video / audio / archivo) */}
            {['image', 'video', 'audio', 'file'].includes(step.type) && (
              <div className="flex flex-col gap-1.5">

                {step.media_url ? (
                  /* ── Archivo subido ── */
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}>
                      <span className="text-emerald-400 text-sm">✓</span>
                      <span className="text-xs text-emerald-300 truncate flex-1">
                        {decodeURIComponent(step.media_url.split('/').pop() ?? '').slice(0, 40)}
                      </span>
                      <button onClick={() => update(idx, { media_url: null, variable_name: null })}
                        className="text-gray-500 hover:text-red-400 shrink-0 transition-colors">✕</button>
                    </div>

                    {/* Variable generada automáticamente */}
                    {step.variable_name && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-gray-500">Variable:</span>
                        {/* Campo editable del nombre */}
                        <input
                          value={step.variable_name}
                          onChange={e => update(idx, { variable_name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() })}
                          style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)' }}
                          className="rounded-lg px-2 py-0.5 font-mono text-[10px] text-violet-300 outline-none w-32"
                        />
                        {/* Chip con la variable completa */}
                        <button
                          onClick={() => {
                            const v = `{{media:${step.variable_name}}}`
                            copyVar(v)
                            onInsertVar?.(v)
                          }}
                          style={{ background: copied === `{{media:${step.variable_name}}}` ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                          className="rounded-lg px-2 py-0.5 font-mono text-[10px] text-violet-300 hover:bg-violet-500/25 transition-colors">
                          {copied === `{{media:${step.variable_name}}}` ? '✓ Copiado' : `{{media:${step.variable_name}}} ↑prompt`}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Botón de subida ── */
                  <label
                    style={{
                      background: uploading === step.id ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.1)',
                      border: '1px dashed rgba(124,58,237,0.35)',
                      cursor: uploading === step.id ? 'not-allowed' : 'pointer',
                    }}
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

                {/* Caption para imagen/video */}
                {(step.type === 'image' || step.type === 'video') && (
                  <div className="space-y-1.5">
                    <textarea value={step.content ?? ''}
                      rows={2}
                      draggable={false}
                      onChange={e => update(idx, { content: e.target.value })}
                      placeholder="Caption (opcional)"
                      className="modal-input min-h-[72px] resize-y text-xs leading-relaxed" />
                    <button type="button"
                      onClick={() => copyText(`caption:${step.id}`, step.content)}
                      className="rounded-lg px-2 py-1 text-[10px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                      {copied === `caption:${step.id}` ? 'Copiado' : 'Copiar caption'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Menú añadir */}
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
