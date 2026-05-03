'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface TenantSettings {
  name:                      string
  whatsapp_number:           string
  phone_number_id:           string
  webhook_verify_token:      string
  meta_token:                string
  openai_key:                string
  system_prompt:             string
  product_name:              string
  product_price:             string
  payment_methods:           string
  welcome_message:           string
  payment_confirmed_message: string
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
  name:                      '',
  whatsapp_number:           '',
  phone_number_id:           '',
  webhook_verify_token:      '',
  meta_token:                '',
  openai_key:                '',
  system_prompt:             DEFAULT_PROMPT,
  product_name:              '',
  product_price:             '',
  payment_methods:           '',
  welcome_message:           '¡Hola! 👋 Gracias por contactarnos. ¿En qué te puedo ayudar?',
  payment_confirmed_message: '✅ ¡Pago confirmado! Tu pedido está siendo procesado. Te avisamos pronto.',
}

const TABS = ['WhatsApp', 'Agente IA', 'Producto'] as const
type Tab = (typeof TABS)[number]

// ─── componente ───────────────────────────────────────────────────────────────
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
    setSaving(true)
    setError('')
    try {
      await apiFetch('/api/tenants/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-gray-400">
        Cargando configuración...
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
      <p className="mt-1 text-sm text-gray-500">Ajustes de tu cuenta NexBot</p>

      {/* ── tabs ── */}
      <div className="mt-6 flex gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-gray-200">
        {tab === 'WhatsApp' && <TabWhatsApp form={form} set={set} />}
        {tab === 'Agente IA' && <TabAgent   form={form} set={set} />}
        {tab === 'Producto'  && <TabProduct form={form} set={set} />}
      </div>

      {/* ── footer ── */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm">
          {error  && <span className="text-red-500">{error}</span>}
          {saved  && <span className="text-emerald-600">✓ Guardado</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}

// ─── tab WhatsApp ─────────────────────────────────────────────────────────────
function TabWhatsApp({ form, set }: TabProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="Nombre del negocio"
        value={form.name}
        onChange={(v) => set('name', v)}
        placeholder="Mi Tienda Online"
      />
      <Field
        label="Número de WhatsApp"
        value={form.whatsapp_number}
        onChange={(v) => set('whatsapp_number', v)}
        placeholder="+591 7XXXXXXX"
        hint="Formato E.164: +591..."
      />
      <Field
        label="Phone Number ID"
        value={form.phone_number_id}
        onChange={(v) => set('phone_number_id', v)}
        placeholder="Meta → WhatsApp → Phone Number ID"
      />
      <Field
        label="Meta Access Token"
        value={form.meta_token}
        onChange={(v) => set('meta_token', v)}
        placeholder="EAAxxxxx..."
        type="password"
        hint="Meta for Developers → WhatsApp → Temporary o Permanent token"
      />
      <Field
        label="Webhook Verify Token"
        value={form.webhook_verify_token}
        onChange={(v) => set('webhook_verify_token', v)}
        placeholder="mi-token-secreto"
        type="password"
        hint="Cadena secreta que configuras en Meta para verificar el webhook"
      />
    </div>
  )
}

// ─── tab Agente IA ────────────────────────────────────────────────────────────
function TabAgent({ form, set }: TabProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="OpenAI API Key"
        value={form.openai_key}
        onChange={(v) => set('openai_key', v)}
        placeholder="sk-..."
        type="password"
        hint="platform.openai.com → API Keys"
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Prompt del agente
        </label>
        <p className="mb-2 text-xs text-gray-400">
          Variables disponibles:{' '}
          {['{{product_name}}', '{{price}}', '{{payment_methods}}'].map((v) => (
            <code key={v} className="mx-0.5 rounded bg-gray-100 px-1 py-0.5 font-mono text-indigo-600">
              {v}
            </code>
          ))}
        </p>
        <textarea
          rows={12}
          value={form.system_prompt}
          onChange={(e) => set('system_prompt', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-sm leading-relaxed outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
    </div>
  )
}

// ─── tab Producto ─────────────────────────────────────────────────────────────
function TabProduct({ form, set }: TabProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Nombre del producto"
          value={form.product_name}
          onChange={(v) => set('product_name', v)}
          placeholder="Curso de Marketing"
        />
        <Field
          label="Precio"
          value={form.product_price}
          onChange={(v) => set('product_price', v)}
          placeholder="97"
          type="number"
          hint="Precio en tu moneda local"
        />
      </div>

      <Field
        label="Métodos de pago"
        value={form.payment_methods}
        onChange={(v) => set('payment_methods', v)}
        placeholder="Transferencia bancaria, QR Tigo Money, PayPal"
        hint="Se inyecta en {{payment_methods}} del prompt del agente"
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Mensaje de bienvenida
        </label>
        <textarea
          rows={3}
          value={form.welcome_message}
          onChange={(e) => set('welcome_message', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <p className="mt-1 text-xs text-gray-400">
          Primer mensaje que recibe el contacto al escribir por primera vez
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          Mensaje de pago confirmado
        </label>
        <textarea
          rows={3}
          value={form.payment_confirmed_message}
          onChange={(e) => set('payment_confirmed_message', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <p className="mt-1 text-xs text-gray-400">
          Se envía automáticamente cuando el validador de comprobantes confirma el pago
        </p>
      </div>
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────
interface TabProps {
  form: TenantSettings
  set:  (field: keyof TenantSettings, value: string) => void
}

interface FieldProps {
  label:       string
  value:       string
  onChange:    (v: string) => void
  placeholder?: string
  type?:       string
  hint?:       string
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
