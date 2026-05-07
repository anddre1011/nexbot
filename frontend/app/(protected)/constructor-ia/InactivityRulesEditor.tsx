'use client'
import { useRef, useState } from 'react'

export interface InactRule {
  id: string; position: number; delay_ms: number
  type: 'text' | 'image' | 'video' | 'media_var'
  content: string | null; media_url: string | null
}

const DELAY_OPTIONS = [
  { ms: 3600000,   label: '1 hora' },
  { ms: 10800000,  label: '3 horas' },
  { ms: 21600000,  label: '6 horas' },
  { ms: 43200000,  label: '12 horas' },
  { ms: 86400000,  label: '24 horas' },
  { ms: 172800000, label: '48 horas' },
]

const RULE_TYPES = [
  { type: 'text',      icon: '💬', label: 'Texto' },
  { type: 'image',     icon: '🖼️', label: 'Imagen' },
  { type: 'video',     icon: '🎬', label: 'Video' },
  { type: 'media_var', icon: '📁', label: 'Variable' },
]

function uid() { return Math.random().toString(36).slice(2, 8) }

export default function InactivityRulesEditor({ rules, onChange }: {
  rules: InactRule[]; onChange: (r: InactRule[]) => void
}) {
  const [uploading, setUploading] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function addRule() {
    onChange([...rules, { id: uid(), position: rules.length, delay_ms: 10800000, type: 'text', content: '', media_url: null }])
  }

  function update(idx: number, patch: Partial<InactRule>) {
    onChange(rules.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function remove(idx: number) {
    onChange(rules.filter((_, i) => i !== idx).map((r, i) => ({ ...r, position: i })))
  }

  async function handleUpload(idx: number, file: File) {
    const rule = rules[idx]
    setUploading(rule.id)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { createClient } = await import('@/lib/supabase/client')
      const { data } = await createClient().auth.getSession()
      const token = data.session?.access_token ?? ''
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'https://nexbot.pro'}/api/upload/flow-media`, {
        method: 'POST', body: fd, headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      update(idx, { media_url: d.url })
    } catch (err) { console.error(err) }
    finally { setUploading(null) }
  }

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-500">Mensajes de inactividad</label>
            <p className="text-[10px] text-gray-600 mt-0.5">Se envían cuando el contacto no responde</p>
          </div>
        </div>
        {/* Aviso 24h */}
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          className="mt-2 rounded-lg px-3 py-2 text-[10px] text-amber-400">
          ⚠️ WhatsApp solo permite mensajes libres dentro de las 24h desde el último mensaje del cliente
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-2">
        {rules.map((rule, idx) => (
          <div key={rule.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="rounded-xl p-3">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2.5">
              {/* Delay selector */}
              <select value={rule.delay_ms} onChange={e => update(idx, { delay_ms: Number(e.target.value) })}
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                className="rounded-lg px-2 py-1 text-xs text-violet-300 outline-none">
                {DELAY_OPTIONS.map(({ ms, label }) => (
                  <option key={ms} value={ms} className="bg-[#1a1a1a]">{label}</option>
                ))}
              </select>
              {/* Tipo */}
              <select value={rule.type} onChange={e => update(idx, { type: e.target.value as InactRule['type'] })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                className="rounded-lg px-2 py-1 text-xs text-gray-300 outline-none">
                {RULE_TYPES.map(({ type, icon, label }) => (
                  <option key={type} value={type} className="bg-[#1a1a1a]">{icon} {label}</option>
                ))}
              </select>
              <span className="ml-auto text-[10px] text-gray-600">#{idx + 1}</span>
              <button onClick={() => remove(idx)} className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Contenido */}
            {rule.type === 'text' && (
              <textarea rows={2} value={rule.content ?? ''}
                onChange={e => update(idx, { content: e.target.value })}
                placeholder="Mensaje de seguimiento..."
                className="modal-input resize-none text-xs w-full" />
            )}

            {rule.type === 'media_var' && (
              <input value={rule.content ?? ''} onChange={e => update(idx, { content: e.target.value })}
                placeholder="{{media:nombre_del_archivo}}"
                className="modal-input text-xs font-mono w-full" />
            )}

            {['image','video'].includes(rule.type) && (
              <div className="flex flex-col gap-1.5">
                {rule.media_url ? (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                    <span className="text-xs text-emerald-400 truncate flex-1">{rule.media_url.split('/').pop()?.slice(0, 40)}</span>
                    <button onClick={() => update(idx, { media_url: null })} className="text-gray-500 hover:text-red-400">✕</button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => fileRefs.current[rule.id]?.click()} disabled={uploading === rule.id}
                      style={{ background: 'rgba(124,58,237,0.1)', border: '1px dashed rgba(124,58,237,0.3)' }}
                      className="w-full rounded-lg py-2 text-xs text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-50">
                      {uploading === rule.id ? '⏳ Subiendo...' : `📁 Subir ${rule.type}`}
                    </button>
                    <input ref={el => { fileRefs.current[rule.id] = el }} type="file"
                      accept={rule.type === 'image' ? 'image/*' : 'video/*'} className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(idx, f) }} />
                    <input value={rule.media_url ?? ''} onChange={e => update(idx, { media_url: e.target.value })}
                      placeholder="o pega URL..." className="modal-input text-xs" />
                  </>
                )}
                <input value={rule.content ?? ''} onChange={e => update(idx, { content: e.target.value })}
                  placeholder="Caption (opcional)" className="modal-input text-xs" />
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={addRule}
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)' }}
        className="w-full rounded-xl py-2.5 text-xs font-medium text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all">
        + Agregar regla de inactividad
      </button>
    </div>
  )
}
