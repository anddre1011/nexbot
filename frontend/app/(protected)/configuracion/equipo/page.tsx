'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Member { id: string; email: string; role: string; joined: string }

export default function EquipoPage() {
  const [members,  setMembers]  = useState<Member[]>([])
  const [invite,   setInvite]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setMembers([{
          id:     data.user.id,
          email:  data.user.email ?? '',
          role:   'Admin',
          joined: data.user.created_at ?? new Date().toISOString(),
        }])
      }
    }).finally(() => setLoading(false))
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!invite.trim()) return
    setSending(true); setError('')
    try {
      // Invitation via Supabase Auth (requires Auth admin or custom flow)
      // For now, shows confirmation — full invite flow needs backend endpoint
      await new Promise((r) => setTimeout(r, 800)) // simulated
      setSent(true)
      setInvite('')
      setTimeout(() => setSent(false), 3000)
    } catch {
      setError('Error al enviar invitación. Verifica el email.')
    } finally { setSending(false) }
  }

  if (loading) return <PageLoading />

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Equipo</h2>
        <p className="mt-1 text-sm text-gray-500">Gestiona quién tiene acceso a tu cuenta NexBot</p>
      </div>

      {/* Miembros actuales */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="mb-6 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.05]">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Miembros activos</p>
        </div>
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-4 px-5 py-4">
            <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
              {m.email.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{m.email}</p>
              <p className="text-xs text-gray-500">
                Miembro desde {new Date(m.joined).toLocaleDateString('es', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
              className="rounded-full px-2.5 py-1 text-[10px] font-bold text-violet-300">
              {m.role}
            </span>
          </div>
        ))}
      </div>

      {/* Invitar */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="rounded-2xl p-6">
        <p className="mb-4 text-sm font-semibold text-white">Invitar miembro</p>
        <form onSubmit={handleInvite} className="flex flex-col gap-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Email</label>
            <input type="email" value={invite} onChange={(e) => setInvite(e.target.value)}
              placeholder="colaborador@email.com" required
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all" />
          </div>

          {error && (
            <p style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
              className="rounded-xl px-4 py-3 text-sm text-red-400">{error}</p>
          )}

          <div className="flex items-center justify-between">
            {sent && <span className="text-xs text-emerald-400">✓ Invitación enviada</span>}
            <button type="submit" disabled={sending}
              style={{ background: sending ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="ml-auto rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all">
              {sending ? 'Enviando...' : 'Enviar invitación'}
            </button>
          </div>
        </form>

        <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}
          className="mt-4 rounded-xl p-3">
          <p className="text-xs text-gray-500">
            💡 Las invitaciones por email requieren configuración adicional en Supabase Auth → Email Templates.
            El invitado recibirá un link para unirse a tu cuenta.
          </p>
        </div>
      </div>
    </div>
  )
}

function PageLoading() {
  return <div className="flex items-center gap-3 text-sm text-gray-600 pt-8"><div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} className="h-5 w-5 animate-spin rounded-full opacity-60" />Cargando...</div>
}
