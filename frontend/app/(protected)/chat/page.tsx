'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { optimizeUploadFile } from '@/lib/media-compress'

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
  has_confirmed_sale?: boolean
  sale_amount?:     number | null
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

function isUrl(value: string | null) {
  return !!value && /^https?:\/\//i.test(value)
}

function fileNameFromUrl(value: string | null) {
  if (!value) return 'archivo'
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').pop() || 'archivo')
  } catch {
    return 'archivo'
  }
}

function mediaTypeFromFile(file: File) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

const STATUS_COLORS: Record<string, string> = {
  bot:    'bg-violet-500/20 text-violet-300',
  human:  'bg-sky-500/20 text-sky-300',
  open:   'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-gray-500/20 text-gray-400',
  converted: 'bg-amber-500/20 text-amber-300',
  disqualified: 'bg-red-500/20 text-red-300',
}

function isConvertedConversation(conv: Conversation) {
  return !!conv.has_confirmed_sale || conv.status === 'converted'
}

function renderMessageContent(msg: Message) {
  if (msg.type === 'image') {
    return isUrl(msg.content)
      ? <img src={msg.content!} alt="Imagen" loading="lazy" decoding="async" className="max-h-72 max-w-full rounded-lg object-contain" />
      : <span className="italic text-gray-400">Imagen</span>
  }
  if (msg.type === 'video') {
    return isUrl(msg.content)
      ? <video src={msg.content!} controls preload="none" className="max-h-72 max-w-full rounded-lg" />
      : <span className="italic text-gray-400">Video</span>
  }
  if (msg.type === 'audio') {
    return isUrl(msg.content)
      ? <audio src={msg.content!} controls preload="none" className="max-w-full" />
      : <span className="italic text-gray-400">{msg.content || 'Audio'}</span>
  }
  if (msg.type === 'document' || msg.type === 'file') {
    return isUrl(msg.content)
      ? <a href={msg.content!} target="_blank" rel="noreferrer" className="text-emerald-200 underline underline-offset-2">{fileNameFromUrl(msg.content)}</a>
      : <span className="italic text-gray-400">{msg.content || 'Archivo'}</span>
  }
  return msg.content
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
  const [recording,       setRecording]       = useState(false)
  const [showFlowPicker,  setShowFlowPicker]  = useState(false)
  const [showComposerFlowPicker, setShowComposerFlowPicker] = useState(false)
  const [flows,           setFlows]           = useState<{ id: string; name: string; active: boolean }[]>([])
  const bottomRef        = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])
  const fileInputRef     = useRef<HTMLInputElement>(null)

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

  // Cargar flujos disponibles para el selector
  useEffect(() => {
    apiFetch<{ id: string; name: string; active: boolean }[]>('/api/flows')
      .then(setFlows)
      .catch(() => {})
  }, [])

  // ─── enviar mensaje manual (activa human takeover) ──────────────────────────
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
      // Reflejar human takeover en estado local
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, status: 'human' } : c))
      fetchConversations()
    } catch (err) {
      console.error('[chat] send:', err)
    } finally {
      setSending(false)
    }
  }

  // ─── grabación y envío de audio ─────────────────────────────────────────────
  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' })
        const fd = new FormData()
        fd.append('file', blob, `audio-${Date.now()}.ogg`)
        try {
          const { url } = await apiFetch<{ url: string }>('/api/upload/flow-media', {
            method: 'POST', body: fd, rawBody: true,
          } as Parameters<typeof apiFetch>[1])
          await apiFetch(`/api/conversations/${selectedId}/send-audio`, {
            method: 'POST',
            body: JSON.stringify({ audio_url: url }),
          })
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(), direction: 'outbound', type: 'audio',
            content: url, created_at: new Date().toISOString(),
          }])
          setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, status: 'human' } : c))
        } catch (err) {
          console.error('[audio] send error:', err)
          alert('Error al enviar audio')
        }
        setRecording(false)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      alert('No se pudo acceder al micrófono')
    }
  }

  function handleStopRecording() {
    mediaRecorderRef.current?.stop()
  }

  async function handleAttachFile(file: File | null) {
    if (!file || !selectedId || sending) return
    setSending(true)
    try {
      const uploadFile = await optimizeUploadFile(file)
      const fd = new FormData()
      fd.append('file', uploadFile)
      const { url } = await apiFetch<{ url: string }>('/api/upload/flow-media', {
        method: 'POST',
        body: fd,
        rawBody: true,
      } as Parameters<typeof apiFetch>[1])

      const type = mediaTypeFromFile(uploadFile)
      const msg = await apiFetch<Message>(`/api/conversations/${selectedId}/send-media`, {
        method: 'POST',
        body: JSON.stringify({ media_url: url, type, filename: uploadFile.name }),
      })
      setMessages(prev => [...prev, msg])
      setConversations(prev => prev.map(c => c.id === selectedId ? { ...c, status: 'human' } : c))
      fetchConversations()
    } catch (err) {
      console.error('[chat] media send:', err)
      alert(err instanceof Error ? err.message : 'Error al enviar archivo')
    } finally {
      setSending(false)
    }
  }

  // ─── lanzar flujo manualmente ────────────────────────────────────────────────
  async function handleTriggerFlow(flowId: string) {
    if (!selectedId) return
    try {
      await apiFetch(`/api/conversations/${selectedId}/trigger-flow`, {
        method: 'POST',
        body: JSON.stringify({ flow_id: flowId }),
      })
      setShowFlowPicker(false)
      setShowComposerFlowPicker(false)
      fetchConversations()
    } catch (err) {
      console.error('[chat] trigger-flow:', err)
      alert('Error al enviar flujo')
    }
  }

  async function handleTestReset() {
    if (!selected) return
    if (!confirm('Reset de prueba: se borrara este contacto con conversaciones, mensajes y ventas asociadas. Usalo solo para tests.')) return
    await apiFetch(`/api/conversations/${selected.id}/test-reset`, { method: 'DELETE' })
    setSelectedId(null)
    setMessages([])
    fetchConversations()
  }

  async function handleStatusChange(status: string) {
    if (!selected) return
    try {
      const updated = await apiFetch<{ id: string; status: string }>(`/api/conversations/${selected.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, status: updated.status } : c))
      fetchConversations()
    } catch (err) {
      console.error('[chat] status:', err)
      alert(err instanceof Error ? err.message : 'Error al cambiar estado')
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
    const matchConverted = !filterConverted || isConvertedConversation(c)

    return matchSearch && matchTab && matchKanban && matchConverted
  })

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f0f] text-gray-100">

      {/* ── Top bar ── */}
      <div style={{ background: '#0d0d14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        className="shrink-0 flex items-center gap-3 px-4 py-3">
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          className="flex flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5">
          <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversación..."
            className="flex-1 bg-transparent text-sm text-gray-400 placeholder-gray-600 outline-none" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          style={{ background: showFilters ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${showFilters ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.07)'}` }}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${showFilters ? 'text-violet-400' : 'text-gray-400 hover:text-white'}`}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
        <button onClick={fetchConversations}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 hover:text-white transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shrink-0">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Crear Flujo
        </button>
      </div>

      {/* ── 3 columnas ── */}
      <div className="flex flex-1 overflow-hidden">

      {/* ══ columna izquierda: lista ══ */}
      <aside className={`flex shrink-0 flex-col border-r border-white/5 bg-[#141414] w-full md:w-80 ${selected ? 'hidden md:flex' : 'flex'}`}>
        {/* Filtros avanzados (desplegable desde top bar) */}
        {showFilters && (
          <div className="px-3 pt-3">
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
          </div>
        )}

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
          {filtered.map((conv) => {
            const converted = isConvertedConversation(conv)
            return (
            <li key={conv.id}>
              <button
                onClick={() => setSelectedId(conv.id)}
                className={`group relative mx-2 my-1 flex w-[calc(100%-1rem)] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all hover:-translate-y-0.5 ${
                  selectedId === conv.id
                    ? converted
                      ? 'border-amber-300/45 bg-amber-500/15 shadow-[0_0_24px_rgba(245,158,11,0.18)]'
                      : 'border-emerald-400/30 bg-emerald-500/10 shadow-[0_0_22px_rgba(16,185,129,0.16)]'
                    : converted
                      ? 'border-amber-400/20 bg-amber-500/[0.07] hover:bg-amber-500/10'
                      : 'border-transparent hover:bg-white/5'
                }`}
              >
                {/* avatar */}
                <div className="relative shrink-0">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white transition-shadow ${
                    converted
                      ? 'bg-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.35)]'
                      : 'bg-emerald-600'
                  } ${
                    selectedId === conv.id
                      ? converted ? 'shadow-[0_0_18px_rgba(245,158,11,0.55)]' : 'shadow-[0_0_18px_rgba(16,185,129,0.55)]'
                      : converted ? 'group-hover:shadow-[0_0_14px_rgba(245,158,11,0.35)]' : 'group-hover:shadow-[0_0_14px_rgba(16,185,129,0.35)]'
                  }`}>
                    {initials(conv.contact_name, conv.contact_phone)}
                  </div>
                  {conv.status === 'bot' && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#141414] bg-violet-500" />
                  )}
                </div>

                {/* info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-100">
                        {conv.contact_name ?? conv.contact_phone}
                      </span>
                      {converted && (
                        <span className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                          Compró
                        </span>
                      )}
                    </div>
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
          )})}
        </ul>
      </aside>

      {/* ══ columna central: chat ══ */}
      <div className={`flex flex-1 flex-col min-w-0 ${selected ? 'flex' : 'hidden md:flex'}`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
              className="flex h-20 w-20 items-center justify-center rounded-3xl">
              <svg className="h-10 w-10 text-violet-400 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-300">Selecciona una conversación</p>
              <p className="mt-1.5 text-xs text-gray-600 leading-relaxed max-w-[220px]">
                Explora tus chats activos o inicia una nueva automatización para conectar con tus clientes de inmediato.
              </p>
            </div>
            <button style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              Nuevo Chat
            </button>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-white/5 bg-[#141414] px-4 py-3">
              <button
                onClick={() => setSelectedId(null)}
                className="md:hidden text-gray-400 hover:text-white transition-colors shrink-0"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
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
                          {renderMessageContent(msg)}
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  handleAttachFile(file)
                  e.currentTarget.value = ''
                }}
              />
              <div className="relative">
                <button
                  onClick={() => setShowComposerFlowPicker(v => !v)}
                  title="Enviar flujo"
                  disabled={!selectedId}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 transition hover:bg-violet-500/20 hover:text-white disabled:opacity-40"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
                {showComposerFlowPicker && (
                  <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
                    className="absolute bottom-full mb-2 right-0 w-56 rounded-xl overflow-hidden shadow-xl z-20">
                    {flows.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-600 text-center">Sin flujos disponibles</p>
                    ) : flows.map(f => (
                      <button key={f.id}
                        onClick={() => handleTriggerFlow(f.id)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-gray-300 hover:bg-white/5 transition-colors">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${f.active ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Enviar archivo"
                disabled={sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828L18 9.828a4 4 0 10-5.657-5.656L5.757 10.757a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              {/* Botón micrófono */}
              <button
                onClick={recording ? handleStopRecording : handleStartRecording}
                title={recording ? 'Detener grabación' : 'Grabar audio'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all ${
                  recording
                    ? 'bg-red-500 animate-pulse text-white'
                    : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {recording ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
              {/* Botón enviar texto */}
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
      <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-4 border-l border-white/5 bg-[#141414] p-4 overflow-y-auto">
        {!selected ? (
          <p className="text-xs text-gray-600 pt-4 text-center">Selecciona una conversación</p>
        ) : (
          <>
            {/* avatar + nombre */}
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-600/30 border-2 border-violet-500/30 text-lg font-bold text-white">
                {initials(selected.contact_name, selected.contact_phone)}
              </div>
              <div>
                <p className="font-semibold text-gray-100">{selected.contact_phone}</p>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <p className="text-[10px] text-emerald-400">Activo ahora</p>
                </div>
              </div>
            </div>

            {/* Acciones rápidas */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Acciones Rápidas</p>
              <div className="flex gap-2 justify-center">
                {[
                  { icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z', label: 'Guardar' },
                  { icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', label: 'Etiquetar' },
                  { icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636', label: 'Bloquear', status: 'disqualified' },
                ].map(a => (
                  <button key={a.label}
                    onClick={() => a.status && handleStatusChange(a.status)}
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                    className="flex flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-gray-400 hover:text-white hover:bg-white/8 transition-colors">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={a.icon} />
                    </svg>
                    <span className="text-[9px]">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <hr className="border-white/5" />

            {/* Información */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Información</p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">Canal</span>
                  <span className="text-[10px] font-medium text-gray-300">WhatsApp</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">Estado</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[selected.status] ?? STATUS_COLORS.open}`}>
                    {selected.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">Campaña</span>
                  <span className="text-[10px] text-gray-400">{selected.campaign_id ? '🎯 Vinculada' : 'Ninguna'}</span>
                </div>
              </div>
            </div>

            <hr className="border-white/5" />

            {/* kanban */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Estado Kanban</p>
              <div className="flex flex-col gap-1.5">
                {(['bot', 'human', 'open', 'closed'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
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

            <hr className="border-white/5" />

            {/* Enviar flujo manualmente */}
            <div className="relative">
              <button
                onClick={() => setShowFlowPicker(v => !v)}
                style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}
                className="w-full rounded-xl py-2 text-xs font-medium text-violet-400 hover:bg-violet-500/15 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Enviar Flujo
              </button>
              {showFlowPicker && (
                <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}
                  className="absolute bottom-full mb-2 left-0 right-0 rounded-xl overflow-hidden shadow-xl z-10">
                  {flows.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-gray-600 text-center">Sin flujos disponibles</p>
                  ) : flows.map(f => (
                    <button key={f.id}
                      onClick={() => handleTriggerFlow(f.id)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-gray-300 hover:bg-white/5 transition-colors">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${f.active ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <hr className="border-white/5" />

            {/* Botón reiniciar conversación (para pruebas) */}
            <button
              onClick={async () => {
                if (!confirm('¿Reiniciar esta conversación? Se borrarán todos los mensajes y la IA volverá a responder.')) return
                await apiFetch(`/api/conversations/${selected.id}/reset-soft`, { method: 'DELETE' })
                setMessages([])
                fetchConversations()
              }}
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
              className="w-full rounded-xl py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/15 transition-colors"
            >
              🔄 Reiniciar conversación
            </button>
            <button
              onClick={handleTestReset}
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
              className="w-full rounded-xl py-2 text-xs font-medium text-red-400 hover:bg-red-500/15 transition-colors"
            >
              Reset test
            </button>
          </>
        )}
      </aside>
      </div>{/* end 3 columnas */}
    </div>
  )
}
