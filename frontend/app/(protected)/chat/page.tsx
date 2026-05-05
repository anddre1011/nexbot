'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Conversation {
  id:              string
  status:          string
  contact_id:      string
  contact_phone:   string
  contact_name:    string | null
  last_message:    string | null
  last_direction:  string | null
  last_message_at: string | null
  unread_count:    number
  campaign_id:     string | null
}

interface Message {
  id:         string
  direction:  'inbound' | 'outbound'
  type:       string
  content:    string | null
  created_at: string
}

type Tab = 'all' | 'assigned' | 'unassigned'

// ─── helpers ──────────────────────────────────────────────────────────────────
function initials(name: string | null, phone: string) {
  if (name) return name.slice(0, 2).toUpperCase()
  return phone.slice(-2)
}

function fmtTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const STATUS_COLORS: Record<string, string> = {
  bot:    'bg-violet-500/20 text-violet-300',
  human:  'bg-sky-500/20 text-sky-300',
  open:   'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-gray-500/20 text-gray-400',
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [messages,      setMessages]      = useState<Message[]>([])
  const [input,         setInput]         = useState('')
  const [sending,       setSending]       = useState(false)
  const [search,        setSearch]        = useState('')
  const [tab,           setTab]           = useState<Tab>('all')
  const [loadingMsgs,   setLoadingMsgs]   = useState(false)
  const [showFilters,   setShowFilters]   = useState(false)
  const [filterKanban,  setFilterKanban]  = useState('all')
  const [filterConverted, setFilterConverted] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // ─── carga de conversaciones ────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>('/api/conversations')
      setConversations(data)
    } catch (err) {
      console.error('[chat] conversations:', err)
    }
  }, [])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  // ─── carga de mensajes al seleccionar conversación ──────────────────────────
  useEffect(() => {
    if (!selectedId) return
    setLoadingMsgs(true)
    apiFetch<Message[]>(`/api/conversations/${selectedId}/messages`)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoadingMsgs(false))

    // Marcar como leído
    apiFetch(`/api/conversations/${selectedId}/read`, { method: 'PATCH' })
      .then(() => {
        setConversations((prev) =>
          prev.map((c) => c.id === selectedId ? { ...c, unread_count: 0 } : c)
        )
      })
      .catch(console.error)
  }, [selectedId])

  // ─── scroll al último mensaje ───────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Supabase Realtime ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    const supabase = createClient()

    const channel = supabase
      .channel(`messages:${selectedId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message])
          fetchConversations()
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedId, fetchConversations])

  // ─── enviar mensaje manual ──────────────────────────────────────────────────
  async function handleSend() {
    if (!input.trim() || !selectedId || sending) return
    setSending(true)
    try {
      const msg = await apiFetch<Message>(`/api/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: input.trim() }),
      })
      setMessages((prev) => [...prev, msg])
      setInput('')
      fetchConversations()
    } catch (err) {
      console.error('[chat] send:', err)
    } finally {
      setSending(false)
    }
  }

  const filtered = conversations.filter((c) => {
    const matchSearch =
      !search ||
      c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.contact_phone.includes(search)

    const matchTab =
      tab === 'all' ||
      (tab === 'assigned' && c.status === 'human') ||
      (tab === 'unassigned' && c.status === 'bot')

    const matchKanban = filterKanban === 'all' || c.status === filterKanban
    const matchConverted = !filterConverted || c.status === 'closed'

    return matchSearch && matchTab && matchKanban && matchConverted
  })

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ══ columna izquierda: lista ══ */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-white/5 bg-[#141414]">
        {/* buscador */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 flex-1">
              <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversación..."
                className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
              />
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${showFilters ? 'bg-violet-600 text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          </div>

          {/* Filtros avanzados */}
          {showFilters && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              className="rounded-xl p-3 mb-2 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Filtrar conversas</p>
              <div>
                <label className="text-[10px] text-gray-500 mb-0.5 block">Kanban</label>
                <select value={filterKanban} onChange={(e) => setFilterKanban(e.target.value)}
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                  className="w-full rounded-lg px-2 py-1.5 text-xs text-gray-200 outline-none">
                  <option value="all" className="bg-[#1a1a1a]">Todos os estágios</option>
                  <option value="human" className="bg-[#1a1a1a]">Humano</option>
                  <option value="bot" className="bg-[#1a1a1a]">Em Atendimento</option>
                  <option value="closed" className="bg-[#1a1a1a]">Vendas</option>
                  <option value="disqualified" className="bg-[#1a1a1a]">Descalificado</option>
                  <option value="abandoned" className="bg-[#1a1a1a]">Abandono</option>
                </select>
              </div>
              <label className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">Apenas convertidos</span>
                <button onClick={() => setFilterConverted(!filterConverted)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${filterConverted ? 'bg-emerald-600' : 'bg-white/10'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${filterConverted ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </label>
            </div>
          )}
        </div>

        {/* tabs */}
        <div className="flex border-b border-white/5 px-3">
          {(['all', 'assigned', 'unassigned'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === t
                  ? 'border-b-2 border-emerald-500 text-emerald-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'all' ? 'Todas' : t === 'assigned' ? 'Asignadas' : 'Sin asignar'}
            </button>
          ))}
        </div>

        {/* lista */}
        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <li className="flex items-center justify-center py-12 text-xs text-gray-600">
              Sin conversaciones
            </li>
          )}
          {filtered.map((conv) => (
            <li key={conv.id}>
              <button
                onClick={() => setSelectedId(conv.id)}
                className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-white/5 ${
                  selectedId === conv.id ? 'bg-white/10' : ''
                }`}
              >
                {/* avatar */}
                <div className="relative shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                    {initials(conv.contact_name, conv.contact_phone)}
                  </div>
                  {conv.status === 'bot' && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#141414] bg-violet-500" />
                  )}
                </div>

                {/* info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="truncate text-sm font-medium text-gray-100">
                      {conv.contact_name ?? conv.contact_phone}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {fmtTime(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1">
                    <p className="truncate text-xs text-gray-500">
                      {conv.last_direction === 'outbound' && (
                        <span className="mr-1 text-emerald-500">✓</span>
                      )}
                      {conv.last_message ?? 'Sin mensajes'}
                    </p>
                    {conv.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ══ columna central: chat ══ */}
      <div className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-gray-600">
            <svg className="h-12 w-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-white/5 bg-[#141414] px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold">
                {initials(selected.contact_name, selected.contact_phone)}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-100">
                  {selected.contact_name ?? selected.contact_phone}
                </p>
                <p className="text-xs text-gray-500">{selected.contact_phone}</p>
              </div>
              <div className="ml-auto">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[selected.status] ?? STATUS_COLORS.open}`}>
                  {selected.status}
                </span>
              </div>
            </div>

            {/* mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-600">
                  Cargando mensajes...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-600">
                  Sin mensajes aún
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {messages.map((msg, i) => {
                    const isOut = msg.direction === 'outbound'
                    const showTime =
                      i === messages.length - 1 ||
                      messages[i + 1].direction !== msg.direction

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[72%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                            isOut
                              ? 'rounded-br-sm bg-[#005c4b] text-gray-100'
                              : 'rounded-bl-sm bg-[#1f1f1f] text-gray-200'
                          }`}
                        >
                          {msg.type === 'image'
                            ? <span className="italic text-gray-400">📷 Imagen</span>
                            : msg.type === 'audio'
                            ? <span className="italic text-gray-400">🎤 Audio</span>
                            : msg.content}
                          {showTime && (
                            <div className={`mt-0.5 text-[10px] ${isOut ? 'text-right text-emerald-300/60' : 'text-gray-500'}`}>
                              {fmtFull(msg.created_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* input */}
            <div className="flex items-end gap-2 border-t border-white/5 bg-[#141414] p-3">
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
                placeholder="Escribe un mensaje..."
                className="flex-1 resize-none rounded-xl bg-white/5 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-emerald-600"
              />
              <button
                onClick={handleSend}
                disabled={sending || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-40"
              >
                <svg className="h-4 w-4 rotate-90" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* ══ columna derecha: info del contacto ══ */}
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-l border-white/5 bg-[#141414] p-4">
        {!selected ? (
          <p className="text-xs text-gray-600">Selecciona una conversación</p>
        ) : (
          <>
            {/* avatar + nombre */}
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
                {initials(selected.contact_name, selected.contact_phone)}
              </div>
              <p className="font-semibold text-gray-100">
                {selected.contact_name ?? 'Sin nombre'}
              </p>
              <p className="text-xs text-gray-500">{selected.contact_phone}</p>
            </div>

            <hr className="border-white/5" />

            {/* datos */}
            <div className="flex flex-col gap-3 text-sm">
              <InfoRow label="Estado">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[selected.status] ?? STATUS_COLORS.open}`}>
                  {selected.status}
                </span>
              </InfoRow>

              <InfoRow label="Campaña">
                <span className="text-xs text-gray-400">
                  {selected.campaign_id ? '🎯 Vinculada' : 'Sin campaña'}
                </span>
              </InfoRow>
            </div>

            <hr className="border-white/5" />

            {/* kanban */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado Kanban</p>
              <div className="flex flex-col gap-1.5">
                {(['bot', 'human', 'open', 'closed'] as const).map((s) => (
                  <button
                    key={s}
                    className={`rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                      selected.status === s
                        ? (STATUS_COLORS[s] ?? '') + ' ring-1 ring-inset ring-current'
                        : 'text-gray-600 hover:bg-white/5'
                    }`}
                  >
                    {s === 'bot'    ? '🤖 Bot activo'
                   : s === 'human' ? '👤 Agente humano'
                   : s === 'open'  ? '🟢 Abierta'
                   :                 '⬜ Cerrada'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </div>
  )
}
