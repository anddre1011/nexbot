'use client'

interface InactRule {
  id: string; position: number; delay_ms: number
  type: 'text' | 'image' | 'video' | 'media_var'
  content: string | null; media_url: string | null
}

const DELAY_PRESETS = [
  { ms: 10800000,  label: '3 horas' },
  { ms: 25200000,  label: '7 horas' },
  { ms: 43200000,  label: '12 horas' },
  { ms: 86400000,  label: '24 horas' },
  { ms: 172800000, label: '48 horas' },
]

const RULE_TYPES = [
  { type: 'text',      icon: '💬', label: 'Texto' },
  { type: 'image',     icon: '🖼️', label: 'Imagen' },
  { type: 'video',     icon: '🎬', label: 'Video' },
  { type: 'media_var', icon: '📁', label: 'Variable Media' },
]

export default function InactivityRulesEditor({ rules, onChange }: {
  rules: InactRule[]; onChange: (r: InactRule[]) => void
}) {
  function addRule() {
    const next: InactRule = {
      id: Math.random().toString(36).slice(2, 8),
      position: rules.length,
      delay_ms: 10800000,
      type: 'text',
      content: '',
      media_url: null,
    }
    onChange([...rules, next])
  }

  function update(idx: number, patch: Partial<InactRule>) {
    onChange(rules.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function remove(idx: number) {
    onChange(rules.filter((_, i) => i !== idx))
  }

  function fmtDelay(ms: number): string {
    const h = ms / 3600000
    if (h < 1) return `${Math.round(ms / 60000)} min`
    if (h >= 24) return `${Math.round(h / 24)} días`
    return `${Math.round(h)} horas`
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">
        Mensajes de inactividad
      </label>
      <p className="mb-3 text-[10px] text-gray-600">
        Se envían cuando el contacto no responde después de X tiempo
      </p>

      {/* Warning 24h */}
      <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
        className="rounded-lg px-3 py-2 mb-3 text-[10px] text-amber-300/80">
        ⚠️ WhatsApp solo permite mensajes libres dentro de las 24h desde el último mensaje del cliente
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {rules.map((rule, idx) => (
          <div key={rule.id}
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            className="rounded-xl p-3">

            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{RULE_TYPES.find(t => t.type === rule.type)?.icon ?? '📦'}</span>

              {/* Delay selector */}
              <select value={rule.delay_ms}
                onChange={(e) => update(idx, { delay_ms: Number(e.target.value) })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                className="rounded-lg px-2 py-1 text-[10px] text-gray-200 outline-none">
                {DELAY_PRESETS.map(p => (
                  <option key={p.ms} value={p.ms} className="bg-[#1a1a1a]">{p.label}</option>
                ))}
              </select>

              {/* Type selector */}
              <select value={rule.type}
                onChange={(e) => update(idx, { type: e.target.value as InactRule['type'] })}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                className="rounded-lg px-2 py-1 text-[10px] text-gray-200 outline-none">
                {RULE_TYPES.map(t => (
                  <option key={t.type} value={t.type} className="bg-[#1a1a1a]">{t.label}</option>
                ))}
              </select>

              <span className="ml-auto text-[10px] text-gray-600">{fmtDelay(rule.delay_ms)}</span>

              <button onClick={() => remove(idx)}
                className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            {(rule.type === 'text' || rule.type === 'media_var') && (
              <input value={rule.content ?? ''}
                onChange={(e) => update(idx, { content: e.target.value })}
                placeholder={rule.type === 'media_var' ? '{{media:video_album_demo}}' : 'Mensaje de seguimiento...'}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500 transition-all" />
            )}

            {(rule.type === 'image' || rule.type === 'video') && (
              <input value={rule.media_url ?? ''}
                onChange={(e) => update(idx, { media_url: e.target.value })}
                placeholder="URL del archivo"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                className="w-full rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-violet-500 transition-all" />
            )}
          </div>
        ))}
      </div>

      <button onClick={addRule}
        style={{ border: '2px dashed rgba(255,255,255,0.08)' }}
        className="w-full rounded-xl py-2.5 text-xs text-gray-500 hover:text-gray-300 hover:border-violet-500/30 transition-all">
        + Agregar regla de inactividad
      </button>
    </div>
  )
}
