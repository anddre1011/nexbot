'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Notif { id: string; type: string; title: string; body: string; read: boolean; created_at: string }
interface Prefs  { sales: boolean; disqualifications: boolean; low_credits: boolean; new_contacts: boolean; push_enabled: boolean }

const TYPE_ICON: Record<string, string>  = { sale: '💰', disqualification: '❌', low_credits: '⚠️', new_contact: '👤' }
const TYPE_COLOR: Record<string, string> = {
  sale: 'rgba(16,185,129,0.1)', disqualification: 'rgba(239,68,68,0.08)',
  low_credits: 'rgba(245,158,11,0.08)', new_contact: 'rgba(124,58,237,0.08)',
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PREF_OPTIONS = [
  { key: 'sales',             label: 'Ventas confirmadas',  desc: 'Cuando se verifica un pago',         icon: '💰' },
  { key: 'disqualifications', label: 'Descalificaciones',   desc: 'Cuando un contacto rechaza la oferta', icon: '❌' },
  { key: 'low_credits',       label: 'Créditos IA bajos',   desc: 'Cuando se agota el saldo de OpenAI', icon: '⚠️' },
  { key: 'new_contacts',      label: 'Nuevos contactos',    desc: 'Cuando llega un lead nuevo',         icon: '👤' },
]

export default function NotificacionesPage() {
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [prefs,  setPrefs]  = useState<Prefs>({ sales: true, disqualifications: true, low_credits: true, new_contacts: false, push_enabled: false })
  const [saving, setSaving] = useState(false)
  const [tab,    setTab]    = useState<'all' | 'settings'>('all')

  const fetchNotifs = useCallback(async () => {
    const data = await apiFetch<Notif[]>('/api/notifications').catch(() => [] as Notif[])
    setNotifs(data ?? [])
  }, [])

  useEffect(() => {
    fetchNotifs()
    apiFetch<Prefs>('/api/notifications/preferences').then(p => { if (p) setPrefs(p) }).catch(() => {})
  }, [fetchNotifs])

  async function markAllRead() {
    await apiFetch('/api/notifications/read-all', { method: 'PATCH' })
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function savePrefs() {
    setSaving(true)
    await apiFetch('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs) }).catch(() => {})
    setSaving(false)
  }

  const unread = notifs.filter(n => !n.read).length

  return (
    <div className="flex flex-col h-full">
      <div style={{ background: '#0d0d14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        className="shrink-0 flex items-center gap-3 px-6 py-3">
        <h1 className="flex-1 text-sm font-bold text-white">Notificaciones</h1>
        {unread > 0 && (
          <button onClick={markAllRead}
            style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
            className="rounded-xl px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20 transition-colors">
            Marcar todas leídas
          </button>
        )}
      </div>

      <div className="flex border-b border-white/5 px-6">
        {([['all', 'Actividad'], ['settings', 'Preferencias']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-3 text-xs font-medium transition-colors ${tab === key ? 'border-b-2 border-violet-500 text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'all' ? (
          <div className="flex flex-col gap-2 max-w-2xl">
            {notifs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                  className="flex h-16 w-16 items-center justify-center rounded-2xl">
                  <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">Sin notificaciones aún</p>
                <p className="text-xs text-gray-700">Aparecerán aquí cuando haya ventas, descalificaciones o alertas</p>
              </div>
            ) : notifs.map(n => (
              <div key={n.id}
                style={{ background: n.read ? 'rgba(255,255,255,0.02)' : (TYPE_COLOR[n.type] ?? 'rgba(255,255,255,0.04)'), border: '1px solid rgba(255,255,255,0.06)' }}
                className="flex items-start gap-3 rounded-xl p-4">
                <span className="text-2xl shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${n.read ? 'text-gray-400' : 'text-white'}`}>{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">{fmtTime(n.created_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-lg space-y-6">
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              className="rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">Qué quieres recibir</h2>
              {PREF_OPTIONS.map(({ key, label, desc, icon }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-200">{label}</p>
                      <p className="text-[11px] text-gray-500">{desc}</p>
                    </div>
                  </div>
                  <button onClick={() => setPrefs(p => ({ ...p, [key]: !p[key as keyof Prefs] }))}
                    className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${prefs[key as keyof Prefs] ? 'bg-violet-600' : 'bg-white/10'}`}>
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${prefs[key as keyof Prefs] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              className="rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-white">Push en el celular</h2>
              <p className="text-xs text-gray-500">Recibe notificaciones aunque la app esté cerrada. Requiere tener NexBot instalado desde el navegador.</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Activar push</span>
                <button onClick={() => setPrefs(p => ({ ...p, push_enabled: !p.push_enabled }))}
                  className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${prefs.push_enabled ? 'bg-violet-600' : 'bg-white/10'}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${prefs.push_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            <button onClick={savePrefs} disabled={saving}
              style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="w-full rounded-xl py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all">
              {saving ? 'Guardando...' : 'Guardar preferencias'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
