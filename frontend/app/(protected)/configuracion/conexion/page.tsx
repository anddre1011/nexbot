'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

interface ConnectResult {
  step: string
  status: 'ok' | 'warning' | 'error' | 'skipped'
  detail?: string
}

const STEP_LABELS: Record<string, string> = {
  validate_token:      '🔑 Validar Token',
  get_waba_id:         '🏢 Obtener WABA ID',
  subscribe_webhooks:  '🔔 Suscribir Webhooks',
  register_phone:      '📱 Registrar Número',
  save_tenant:         '💾 Guardar Configuración',
}

export default function ConexionPage() {
  const [tenantId,  setTenantId]  = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [form, setForm] = useState({
    whatsapp_number:      '',
    phone_number_id:      '',
    meta_token:           '',
    webhook_verify_token: '',
    waba_id:              '',
  })

  // Estado de conexión
  const [connecting, setConnecting] = useState(false)
  const [connectResults, setConnectResults] = useState<ConnectResult[]>([])
  const [connected, setConnected] = useState(false)

  // ─── cargar tenant actual ──────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('tenants')
        .select('id, whatsapp_number, phone_number_id, meta_token, webhook_verify_token, waba_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (data) {
        setTenantId(data.id)
        const rawPhoneId = data.phone_number_id ?? ''
        const cleanPhoneId = rawPhoneId.includes('@') ? '' : rawPhoneId

        if (rawPhoneId !== cleanPhoneId) {
          await supabase.from('tenants').update({ phone_number_id: null }).eq('id', data.id)
        }

        setForm({
          whatsapp_number:      data.whatsapp_number ?? '',
          phone_number_id:      cleanPhoneId,
          meta_token:           data.meta_token ?? '',
          webhook_verify_token: data.webhook_verify_token ?? '',
          waba_id:              data.waba_id ?? '',
        })

        // Si ya tiene token y phone_id, está conectado
        if (data.meta_token && data.phone_number_id && !data.meta_token.startsWith('••')) {
          setConnected(true)
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  const isConfigured = !!(form.whatsapp_number && form.meta_token && form.phone_number_id)

  // ─── CONECTAR WHATSAPP (automático) ─────────────────────────────────────────
  async function handleConnect() {
    setError('')
    if (!form.whatsapp_number.trim()) { setError('El número de WhatsApp es obligatorio'); return }
    if (!form.phone_number_id.trim()) { setError('El Phone Number ID es obligatorio'); return }
    if (!form.meta_token.trim())      { setError('El Meta Access Token es obligatorio'); return }

    setConnecting(true)
    setConnectResults([])

    try {
      // Asegurar usuario en public.users
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')
      await supabase.from('users').upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id' })

      // Llamar endpoint que hace TODO automáticamente
      const result = await apiFetch<{
        ok: boolean
        connected: boolean
        tenant_id: string
        waba_id: string | null
        webhook_url: string
        results: ConnectResult[]
      }>('/api/tenants/connect-whatsapp', {
        method: 'POST',
        body: JSON.stringify({
          meta_token:           form.meta_token.trim(),
          phone_number_id:      form.phone_number_id.trim(),
          whatsapp_number:      form.whatsapp_number.trim(),
          webhook_verify_token: form.webhook_verify_token.trim() || null,
          waba_id:              form.waba_id.trim() || null,
        }),
      })

      setConnectResults(result.results)
      setTenantId(result.tenant_id)

      if (result.connected) {
        setConnected(true)
      } else {
        const errorStep = result.results.find(r => r.status === 'error')
        setError(errorStep?.detail ?? 'Algunos pasos fallaron')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al conectar')
    } finally {
      setConnecting(false)
    }
  }

  // ─── desconectar ───────────────────────────────────────────────────────────
  async function handleDisconnect() {
    if (!confirm('¿Desconectar WhatsApp? Se borrarán las credenciales Meta.')) return
    if (!tenantId) return
    setError('')
    try {
      const supabase = createClient()
      const { error: err } = await supabase
        .from('tenants')
        .update({ meta_token: null, phone_number_id: null, webhook_verify_token: null })
        .eq('id', tenantId)
      if (err) throw new Error(err.message)
      setForm((p) => ({ ...p, meta_token: '', phone_number_id: '', webhook_verify_token: '' }))
      setConnected(false)
      setConnectResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al desconectar')
    }
  }

  if (loading) return <PageLoading />

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Conexión WhatsApp</h2>
        <p className="mt-1 text-sm text-gray-500">Conecta tu número de WhatsApp Business — NexBot configura todo automáticamente</p>
      </div>

      {/* Badge de estado */}
      <div style={{
        background: connected ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
        border: `1px solid ${connected ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
      }} className="mb-6 flex items-center gap-4 rounded-2xl p-4">
        <div className={`h-3 w-3 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
          style={{ boxShadow: connected ? '0 0 8px rgba(16,185,129,0.7)' : 'none' }} />
        <div className="flex-1">
          <p className={`text-sm font-semibold ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {connected ? '✓ WhatsApp conectado — webhooks activos' : 'Sin conectar'}
          </p>
          <p className="text-xs text-gray-500">
            {connected ? `Número: ${form.whatsapp_number}` : 'Completa el formulario y haz click en Conectar'}
          </p>
        </div>
        {connected && (
          <button onClick={handleDisconnect}
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors">
            Desconectar
          </button>
        )}
      </div>

      {/* Pasos de configuración */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="mb-6 rounded-2xl p-5">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">Cómo obtener las credenciales</p>
        <div className="flex flex-col gap-3">
          {[
            { n: '1', t: 'Crea una App en Meta for Developers', d: 'developers.facebook.com → Mis Apps → Crear → Tipo: Empresa' },
            { n: '2', t: 'Agrega el producto WhatsApp',         d: 'Tu app → Agregar Productos → WhatsApp → Configurar' },
            { n: '3', t: 'Obtén el Access Token',               d: 'WhatsApp → API Setup → copia el Token de acceso permanente' },
            { n: '4', t: 'Obtén el Phone Number ID',            d: 'WhatsApp → API Setup → FROM field → copia el Phone Number ID' },
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

        <DField label="Número de WhatsApp *" value={form.whatsapp_number}
          onChange={(v) => setForm((p) => ({ ...p, whatsapp_number: v }))}
          placeholder="+591 7XXXXXXX" hint="Formato E.164 con código de país" />

        <DField label="Phone Number ID *" value={form.phone_number_id}
          onChange={(v) => setForm((p) => ({ ...p, phone_number_id: v }))}
          placeholder="ID numérico de Meta (ej: 123456789012345)" />

        <DField label="Meta Access Token *" value={form.meta_token}
          onChange={(v) => setForm((p) => ({ ...p, meta_token: v }))}
          placeholder="EAAxxxxx..." type="password"
          hint="Token permanente de tu app de Meta (System User Token)" />

        <DField label="Webhook Verify Token" value={form.webhook_verify_token}
          onChange={(v) => setForm((p) => ({ ...p, webhook_verify_token: v }))}
          placeholder="mi-token-secreto"
          hint="Opcional — cadena secreta para verificar el webhook" />

        <DField label="WABA ID (WhatsApp Business Account ID)" value={form.waba_id}
          onChange={(v) => setForm((p) => ({ ...p, waba_id: v }))}
          placeholder="ID numérico del WABA (ej: 123456789012345)"
          hint="Meta → tu App → WhatsApp → API Setup → arriba aparece el WABA ID. Necesario para suscribir webhooks." />

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
            className="rounded-xl px-4 py-3 text-sm text-red-400">
            ⚠️ {error}
          </div>
        )}

        {/* Resultados de conexión */}
        {connectResults.length > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            className="rounded-xl p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-500">
              Diagnóstico de conexión
            </p>
            <div className="flex flex-col gap-2">
              {connectResults.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-base">
                    {r.status === 'ok' ? '✅' : r.status === 'warning' ? '⚠️' : r.status === 'skipped' ? '⏭️' : '❌'}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-300">
                      {STEP_LABELS[r.step] ?? r.step}
                    </p>
                    {r.detail && (
                      <p className="text-[10px] text-gray-500">{r.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Webhook URL info + botón */}
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <p className="text-[10px] text-gray-600 mb-0.5">Webhook URL para Meta:</p>
            <code className="text-[11px] text-violet-400 break-all">
              https://nexbot.pro/api/whatsapp/webhook
            </code>
          </div>
          <button onClick={handleConnect} disabled={connecting || !isConfigured}
            style={{
              background: connecting
                ? 'rgba(124,58,237,0.4)'
                : 'linear-gradient(135deg, #7c3aed, #2563eb)',
            }}
            className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50">
            {connecting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Conectando...
              </span>
            ) : connected ? 'Reconectar' : '🚀 Conectar WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DField({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string
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

function PageLoading() {
  return (
    <div className="flex items-center gap-3 pt-8 text-sm text-gray-600">
      <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
        className="h-5 w-5 animate-spin rounded-full opacity-60" />
      Cargando...
    </div>
  )
}
