'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Integration { key: keyof Keys; label: string; desc: string; placeholder: string; docsUrl: string; icon: string }
interface Keys { openai_key: string; elevenlabs_key: string }

const INTEGRATIONS: Integration[] = [
  {
    key:         'openai_key',
    label:       'OpenAI API Key',
    desc:        'Alimenta el agente IA, validación de comprobantes y generación de respuestas con GPT-4o.',
    placeholder: 'sk-proj-...',
    docsUrl:     'https://platform.openai.com/api-keys',
    icon:        '🤖',
  },
  {
    key:         'elevenlabs_key',
    label:       'ElevenLabs API Key',
    desc:        'Opcional — genera mensajes de voz realistas para responder a tus clientes por audio.',
    placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    docsUrl:     'https://elevenlabs.io/app/settings/api-keys',
    icon:        '🎙️',
  },
]

export default function IntegracionesPage() {
  const [keys,    setKeys]    = useState<Keys>({ openai_key: '', elevenlabs_key: '' })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<keyof Keys | null>(null)
  const [saved,   setSaved]   = useState<keyof Keys | null>(null)

  useEffect(() => {
    apiFetch<{ openai_key?: string; elevenlabs_key?: string }>('/api/tenants/settings')
      .then((d) => {
        if (d) setKeys({ openai_key: d.openai_key ?? '', elevenlabs_key: (d as { elevenlabs_key?: string }).elevenlabs_key ?? '' })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(field: keyof Keys) {
    setSaving(field)
    try {
      await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify({ [field]: keys[field] || null }) })
      setSaved(field)
      setTimeout(() => setSaved(null), 3000)
    } catch (err) { console.error(err) }
    finally { setSaving(null) }
  }

  async function handleDelete(field: keyof Keys) {
    if (!confirm('¿Eliminar esta API Key?')) return
    setKeys((p) => ({ ...p, [field]: '' }))
    await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify({ [field]: null }) })
  }

  if (loading) return <PageLoading />

  return (
    <div className="max-w-2xl">
      <PageHeader title="Integraciones" sub="Conecta servicios externos de IA y automatización" />

      <div className="flex flex-col gap-5">
        {INTEGRATIONS.map(({ key, label, desc, placeholder, docsUrl, icon }) => {
          const hasValue = keys[key] && !keys[key].startsWith('••')
          return (
            <div key={key} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              className="rounded-2xl p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-xl">
                    {icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 max-w-xs">{desc}</p>
                  </div>
                </div>
                {hasValue ? (
                  <span style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold text-emerald-400">
                    ✓ Conectado
                  </span>
                ) : (
                  <span style={{ background: 'rgba(107,114,128,0.12)', border: '1px solid rgba(107,114,128,0.2)' }}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium text-gray-500">
                    Sin conectar
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={keys[key]}
                  onChange={(e) => setKeys((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={hasValue ? '••••••••••••••••' : placeholder}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                />
                <button onClick={() => handleSave(key)} disabled={saving === key}
                  style={{ background: saving === key ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
                  className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50">
                  {saving === key ? '...' : saved === key ? '✓' : 'Guardar'}
                </button>
                {hasValue && (
                  <button onClick={() => handleDelete(key)}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                    className="shrink-0 rounded-xl px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/20 transition-colors">
                    🗑
                  </button>
                )}
              </div>

              <a href={docsUrl} target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-gray-600 hover:text-violet-400 transition-colors">
                ↗ Obtener API Key
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PageHeader({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-6"><h2 className="text-xl font-bold text-white">{title}</h2><p className="mt-1 text-sm text-gray-500">{sub}</p></div>
}
function PageLoading() {
  return <div className="flex items-center gap-3 text-sm text-gray-600 pt-8"><div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} className="h-5 w-5 animate-spin rounded-full opacity-60" />Cargando...</div>
}
