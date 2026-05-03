'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface ConnectionState {
  whatsapp_number:    string | null
  phone_number_id:    string | null
  meta_token:         string | null
  webhook_verify_token: string | null
}

export default function ConexionPage() {
  const [conn,    setConn]    = useState<ConnectionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [form,    setForm]    = useState({ whatsapp_number: '', phone_number_id: '', meta_token: '', webhook_verify_token: '' })

  useEffect(() => {
    apiFetch<ConnectionState>('/api/tenants/settings')
      .then((data) => {
        setConn(data)
        if (data) setForm({
          whatsapp_number:       data.whatsapp_number ?? '',
          phone_number_id:       data.phone_number_id ?? '',
          meta_token:            data.meta_token ?? '',
          webhook_verify_token:  data.webhook_verify_token ?? '',
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const isConnected = !!(conn?.whatsapp_number && conn?.meta_token)

  async function handleSave() {
    setSaving(true)
    try {
      await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify(form) })
      setConn((prev) => prev ? { ...prev, ...form } : form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  async function handleDisconnect() {
    if (!confirm('¿Desconectar WhatsApp? Se borrarán las credenciales Meta.')) return
    await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify({ meta_token: '', phone_number_id: '', whatsapp_number: '' }) })
    setConn((prev) => prev ? { ...prev, meta_token: null, phone_number_id: null, whatsapp_number: null } : prev)
    setForm({ whatsapp_number: '', phone_number_id: '', meta_token: '', webhook_verify_token: '' })
  }

  if (loading) return <PageLoading />

  return (
    <div className="max-w-2xl">
      <PageHeader title="Conexión WhatsApp" sub="Conecta tu número de WhatsApp Business vía Meta Cloud API" />

      {/* Estado de conexión */}
      <div style={{ background: isConnected ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${isConnected ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}` }}
        className="mb-6 flex items-center gap-4 rounded-2xl p-4">
        <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-amber-400'}`} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isConnected ? 'WhatsApp conectado' : 'Sin conectar'}
          </p>
          <p className="text-xs text-gray-500">
            {isConnected ? `Número: ${conn?.whatsapp_number}` : 'Completa el formulario para conectar tu número'}
          </p>
        </div>
        {isConnected && (
          <button onClick={handleDisconnect}
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors">
            Desconectar
          </button>
        )}
      </div>

      {/* Pasos */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="mb-6 rounded-2xl p-5">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">Cómo obtener las credenciales</p>
        <div className="flex flex-col gap-3">
          {[
            { n: '1', t: 'Crea una App en Meta for Developers', d: 'developers.facebook.com → Mis Apps → Crear → Tipo: Empresa' },
            { n: '2', t: 'Agrega el producto WhatsApp', d: 'En tu app → Agregar Productos → WhatsApp → Configurar' },
            { n: '3', t: 'Obtén el Access Token', d: 'WhatsApp → API Setup → copia el Token temporal (o genera uno permanente)' },
            { n: '4', t: 'Obtén el Phone Number ID', d: 'WhatsApp → API Setup → FROM field → copia el Phone Number ID' },
          ].map(({ n, t, d }) => (
            <div key={n} className="flex gap-3">
              <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                {n}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-200">{t}</p>
                <p className="text-xs text-gray-500">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Formulario */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="rounded-2xl p-6 flex flex-col gap-5">
        <DField label="Número de WhatsApp" value={form.whatsapp_number} onChange={(v) => setForm((p) => ({ ...p, whatsapp_number: v }))} placeholder="+591 7XXXXXXX" hint="Formato E.164 con código de país" />
        <DField label="Phone Number ID" value={form.phone_number_id} onChange={(v) => setForm((p) => ({ ...p, phone_number_id: v }))} placeholder="ID numérico de Meta" />
        <DField label="Meta Access Token" value={form.meta_token} onChange={(v) => setForm((p) => ({ ...p, meta_token: v }))} placeholder="EAAxxxxx..." type="password" hint="Token de acceso de tu app de Meta" />
        <DField label="Webhook Verify Token" value={form.webhook_verify_token} onChange={(v) => setForm((p) => ({ ...p, webhook_verify_token: v }))} placeholder="mi-token-secreto" hint="Cadena secreta que defines tú — la misma que pones en Meta" />

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-600">
            Webhook URL: <code className="text-violet-400">{process.env.NEXT_PUBLIC_API_URL}/api/whatsapp/webhook</code>
          </p>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-emerald-400">✓ Guardado</span>}
            <button onClick={handleSave} disabled={saving}
              style={{ background: saving ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50">
              {saving ? 'Guardando...' : isConnected ? 'Actualizar' : 'Conectar WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DField({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" />
      {hint && <p className="mt-1.5 text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{sub}</p>
    </div>
  )
}

function PageLoading() {
  return (
    <div className="flex items-center gap-3 text-sm text-gray-600 pt-8">
      <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
        className="h-5 w-5 animate-spin rounded-full opacity-60" />
      Cargando...
    </div>
  )
}
