'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface TenantSettings {
  name: string; whatsapp_number: string; phone_number_id: string
  webhook_verify_token: string; meta_token: string; openai_key: string
  system_prompt: string; product_name: string; product_price: string
  payment_methods: string; welcome_message: string; payment_confirmed_message: string
}

const DEFAULT_PROMPT = `Eres un asistente de ventas de {{product_name}} por WhatsApp.
Tu objetivo es responder dudas sobre el producto y guiar al cliente al cierre de la venta.

Producto: {{product_name}}
Precio: {{price}}
Métodos de pago aceptados: {{payment_methods}}

Reglas:
- Respuestas cortas y amables, máximo 3 oraciones.
- Si el cliente pregunta el precio, indícalo claramente.
- Si el cliente quiere pagar, explica cómo hacerlo usando los métodos de pago.
- Si no puedes resolver algo, di que un asesor lo atenderá.`

const EMPTY: TenantSettings = {
  name: '', whatsapp_number: '', phone_number_id: '', webhook_verify_token: '',
  meta_token: '', openai_key: '', system_prompt: DEFAULT_PROMPT,
  product_name: '', product_price: '', payment_methods: '',
  welcome_message: '¡Hola! 👋 Gracias por contactarnos. ¿En qué te puedo ayudar?',
  payment_confirmed_message: '✅ ¡Pago confirmado! Tu pedido está siendo procesado. Te avisamos pronto.',
}

const TABS = ['WhatsApp', 'Agente IA', 'Producto'] as const
type Tab = (typeof TABS)[number]

const TAB_ICONS: Record<Tab, string> = {
  'WhatsApp':  '💬',
  'Agente IA': '🤖',
  'Producto':  '📦',
}

export default function SettingsPage() {
  const [tab,     setTab]     = useState<Tab>('WhatsApp')
  const [form,    setForm]    = useState<TenantSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    apiFetch<TenantSettings | null>('/api/tenants/settings')
      .then((data) => { if (data) setForm({ ...EMPTY, ...data }) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function set(field: keyof TenantSettings, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify(form) })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a0a0f]">
        <div className="flex flex-col items-center gap-3">
          <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="h-8 w-8 animate-spin rounded-full opacity-70" />
          <p className="text-sm text-gray-500">Cargando configuración...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#0a0a0f] p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Configuración</h1>
        <p className="mt-1 text-sm text-gray-500">Ajustes de tu cuenta NexBot</p>
      </div>

      <div className="mx-auto max-w-2xl">
        {/* Tabs */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          className="mb-6 flex gap-1 rounded-2xl p-1.5">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={tab === t ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2))', border: '1px solid rgba(124,58,237,0.4)' } : {}}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all ${
                tab === t ? 'text-violet-300' : 'text-gray-500 hover:text-gray-300'
              }`}>
              <span>{TAB_ICONS[t]}</span>
              {t}
            </button>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          className="rounded-2xl p-6">
          {tab === 'WhatsApp' && <TabWhatsApp form={form} set={set} />}
          {tab === 'Agente IA' && <TabAgent   form={form} set={set} />}
          {tab === 'Producto'  && <TabProduct form={form} set={set} />}
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm">
            {error  && <span className="text-red-400">{error}</span>}
            {saved  && <span className="text-emerald-400">✓ Guardado correctamente</span>}
          </div>
          <button onClick={handleSave} disabled={saving}
            style={{ background: saving ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── campos compartidos ───────────────────────────────────────────────────────
interface TabProps { form: TenantSettings; set: (f: keyof TenantSettings, v: string) => void }

function DField({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-500">
        {label}
      </label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" />
      {hint && <p className="mt-1.5 text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

// ─── Tab WhatsApp ─────────────────────────────────────────────────────────────
function TabWhatsApp({ form, set }: TabProps) {
  return (
    <div className="flex flex-col gap-5">
      <DField label="Nombre del negocio" value={form.name} onChange={(v) => set('name', v)} placeholder="Mi Tienda Online" />
      <DField label="Número de WhatsApp" value={form.whatsapp_number} onChange={(v) => set('whatsapp_number', v)} placeholder="+591 7XXXXXXX" hint="Formato E.164: +591..." />
      <DField label="Phone Number ID" value={form.phone_number_id} onChange={(v) => set('phone_number_id', v)} placeholder="Meta → WhatsApp → Phone Number ID" />
      <DField label="Meta Access Token" value={form.meta_token} onChange={(v) => set('meta_token', v)} placeholder="EAAxxxxx..." type="password" hint="Meta for Developers → WhatsApp → Access Token" />
      <DField label="Webhook Verify Token" value={form.webhook_verify_token} onChange={(v) => set('webhook_verify_token', v)} placeholder="mi-token-secreto" type="password" hint="Cadena secreta para verificar el webhook en Meta" />
    </div>
  )
}

// ─── Tab Agente IA ────────────────────────────────────────────────────────────
function TabAgent({ form, set }: TabProps) {
  const VARS = ['{{product_name}}', '{{price}}', '{{payment_methods}}']
  return (
    <div className="flex flex-col gap-5">
      <DField label="OpenAI API Key" value={form.openai_key} onChange={(v) => set('openai_key', v)} placeholder="sk-..." type="password" hint="platform.openai.com → API Keys" />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-widest text-gray-500">Prompt del agente</label>
          <div className="flex gap-1.5">
            {VARS.map((v) => (
              <button key={v} type="button" onClick={() => set('system_prompt', form.system_prompt + ' ' + v)}
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                className="rounded-lg px-2 py-0.5 font-mono text-[10px] text-violet-300 hover:bg-violet-500/20 transition-colors">
                {v}
              </button>
            ))}
          </div>
        </div>
        <textarea rows={10} value={form.system_prompt} onChange={(e) => set('system_prompt', e.target.value)}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          className="w-full rounded-xl px-4 py-3 font-mono text-xs leading-relaxed text-gray-200 placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-none" />
      </div>
    </div>
  )
}

// ─── Tab Producto ─────────────────────────────────────────────────────────────
function TabProduct({ form, set }: TabProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <DField label="Nombre del producto" value={form.product_name} onChange={(v) => set('product_name', v)} placeholder="Curso de Marketing" />
        <DField label="Precio (BOB)" value={form.product_price} onChange={(v) => set('product_price', v)} placeholder="97" type="number" />
      </div>
      <DField label="Métodos de pago" value={form.payment_methods} onChange={(v) => set('payment_methods', v)} placeholder="QR Tigo Money, Transferencia, PayPal" hint="Se inyecta en {{payment_methods}} del prompt" />
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-500">Mensaje de bienvenida</label>
        <textarea rows={3} value={form.welcome_message} onChange={(e) => set('welcome_message', e.target.value)}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-none" />
        <p className="mt-1.5 text-xs text-gray-600">Primer mensaje al contactar por primera vez</p>
      </div>
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-500">Mensaje pago confirmado</label>
        <textarea rows={3} value={form.payment_confirmed_message} onChange={(e) => set('payment_confirmed_message', e.target.value)}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 resize-none" />
        <p className="mt-1.5 text-xs text-gray-600">Se envía automáticamente al validar el comprobante</p>
      </div>
    </div>
  )
}
