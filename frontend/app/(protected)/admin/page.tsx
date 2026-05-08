'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Tenant {
  id: string
  name: string
  whatsapp_number: string | null
  plan: string
  active: boolean
  created_at: string
  user_id: string
  users?: { email: string } | null
  subscriptions?: {
    status: string
    started_at: string
    expires_at: string
    plans?: { name: string; price_bob: number } | null
  }[]
}

function daysLeft(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading]  = useState(true)
  const [isAdmin, setIsAdmin]  = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      // Solo el primer usuario registrado (owner) puede ver este panel
      const { data: allUsers } = await supabase
        .from('users').select('id, email').order('created_at', { ascending: true }).limit(1)

      if (!allUsers?.[0] || allUsers[0].id !== user?.id) {
        setIsAdmin(false); setLoading(false); return
      }

      setIsAdmin(true)

      const { data } = await supabase
        .from('tenants')
        .select(`
          id, name, whatsapp_number, plan, active, created_at, user_id,
          users(email),
          subscriptions(status, started_at, expires_at, plans(name, price_bob))
        `)
        .order('created_at', { ascending: false })

      setTenants((data ?? []) as unknown as Tenant[])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-[#0a0a0f]">
      <div style={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)' }} className="h-8 w-8 animate-spin rounded-full opacity-60" />
    </div>
  )

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-full bg-[#0a0a0f]">
      <p className="text-gray-500 text-sm">Acceso denegado — solo disponible para el administrador</p>
    </div>
  )

  const active = tenants.filter(t => t.active).length
  const totalRevenue = tenants.reduce((s, t) => {
    const sub = t.subscriptions?.[0]
    return s + (sub?.plans?.price_bob ?? 0)
  }, 0)

  return (
    <div className="min-h-full bg-[#0a0a0f] p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
        <p className="text-sm text-gray-500 mt-1">Vista general de todos los tenants de NexBot</p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Tenants activos', value: active, color: 'text-emerald-400' },
          { label: 'Tenants totales', value: tenants.length, color: 'text-blue-400' },
          { label: 'MRR (BOB)', value: `BOB ${totalRevenue}`, color: 'text-violet-400' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            className="rounded-2xl p-5">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabla de tenants */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-600">
            <tr>
              <th className="px-5 py-3">Negocio</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">WhatsApp</th>
              <th className="px-5 py-3">Plan</th>
              <th className="px-5 py-3">Suscripción</th>
              <th className="px-5 py-3 text-center">Días restantes</th>
              <th className="px-5 py-3 text-center">Estado</th>
              <th className="px-5 py-3">Registro</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-600 text-xs">Sin tenants registrados</td></tr>
            )}
            {tenants.map((t, i) => {
              const sub = t.subscriptions?.[0]
              const days = sub?.expires_at ? daysLeft(sub.expires_at) : null
              const urgent = days !== null && days <= 5
              return (
                <tr key={t.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td className="px-5 py-3 font-semibold text-gray-200">{t.name}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{(t.users as any)?.email ?? '–'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{t.whatsapp_number ?? '–'}</td>
                  <td className="px-5 py-3">
                    <span style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold text-violet-300 capitalize">
                      {sub?.plans?.name ?? t.plan}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {sub ? (
                      <span className={sub.status === 'active' ? 'text-emerald-400' : 'text-red-400'}>
                        {sub.status === 'active' ? '✓ Activa' : '✗ ' + sub.status}
                      </span>
                    ) : <span className="text-gray-600">Sin plan</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {days !== null ? (
                      <span className={`text-sm font-bold ${urgent ? 'text-red-400' : days <= 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {urgent && '⚠️ '}{days}d
                      </span>
                    ) : <span className="text-gray-600">–</span>}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`h-2 w-2 rounded-full inline-block ${t.active ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{fmtDate(t.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
