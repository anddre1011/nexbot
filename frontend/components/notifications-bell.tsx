'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

interface Notif {
  id: string
  type: 'sale' | 'disqualification' | 'low_credits' | 'new_contact'
  title: string
  body: string
  read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, string> = {
  sale:             '💰',
  disqualification: '❌',
  low_credits:      '⚠️',
  new_contact:      '👤',
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1)  return 'ahora'
  if (diffMin < 60) return `hace ${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `hace ${diffH}h`
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

export default function NotificationsBell() {
  const [notifs,  setNotifs]  = useState<Notif[]>([])
  const [open,    setOpen]    = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = notifs.filter(n => !n.read).length

  const fetchNotifs = useCallback(async () => {
    try {
      const data = await apiFetch<Notif[]>('/api/notifications')
      setNotifs(data ?? [])
    } catch {}
  }, [])

  useEffect(() => { fetchNotifs() }, [fetchNotifs])

  // Tiempo real via Supabase
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => fetchNotifs())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchNotifs])

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function markAllRead() {
    await apiFetch('/api/notifications/read-all', { method: 'PATCH' })
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ background: '#0d0d18', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
          className="absolute right-0 top-11 w-80 rounded-2xl overflow-hidden z-50">

          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-sm font-semibold text-white">Notificaciones</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors">
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <svg className="h-8 w-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-xs text-gray-600">Sin notificaciones aún</p>
              </div>
            ) : notifs.map(n => (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${!n.read ? 'bg-white/[0.02]' : ''}`}>
                <span className="text-xl shrink-0 mt-0.5">{TYPE_ICON[n.type] ?? '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${!n.read ? 'text-white' : 'text-gray-400'}`}>{n.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] text-gray-600">{fmtTime(n.created_at)}</span>
                  {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
                </div>
              </button>
            ))}
          </div>

          <div className="px-4 py-2.5 border-t border-white/5">
            <a href="/notificaciones"
              className="block text-center text-[11px] text-violet-400 hover:text-violet-300 transition-colors">
              Ver todas las notificaciones →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
