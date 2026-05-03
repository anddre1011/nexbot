'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface KanbanCard {
  id:              string
  status:          string
  contact_id:      string
  contact_phone:   string
  contact_name:    string | null
  campaign_name:   string | null
  campaign_id:     string | null
  last_message_at: string | null
  sale_amount:     number | null
  created_at:      string
}

type DateFilter = 'today' | 'week' | 'month' | 'all'

// ─── columnas del kanban ──────────────────────────────────────────────────────
const COLUMNS = [
  { id: 'human',        label: 'Humano',        dot: 'bg-orange-500',  ring: 'ring-orange-500/30',  header: 'text-orange-400' },
  { id: 'attending',    label: 'En Atención',   dot: 'bg-blue-500',    ring: 'ring-blue-500/30',    header: 'text-blue-400'   },
  { id: 'converted',    label: 'Convertido',    dot: 'bg-emerald-500', ring: 'ring-emerald-500/30', header: 'text-emerald-400'},
  { id: 'disqualified', label: 'Descalificado', dot: 'bg-red-500',     ring: 'ring-red-500/30',     header: 'text-red-400'    },
  { id: 'abandoned',    label: 'Abandono',      dot: 'bg-red-400',     ring: 'ring-red-400/30',     header: 'text-red-300'    },
] as const

const DATE_LABELS: Record<DateFilter, string> = {
  today: 'Hoy', week: 'Semana', month: 'Mes', all: 'Todo',
}

function dateFrom(filter: DateFilter): string | undefined {
  const d = new Date()
  if (filter === 'today') { d.setHours(0, 0, 0, 0); return d.toISOString() }
  if (filter === 'week')  { d.setDate(d.getDate() - 7); return d.toISOString() }
  if (filter === 'month') { d.setDate(d.getDate() - 30); return d.toISOString() }
  return undefined
}

function timeAgo(iso: string | null): string {
  if (!iso) return '–'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'ahora'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function initials(name: string | null, phone: string) {
  if (name) return name.slice(0, 2).toUpperCase()
  return phone.slice(-2)
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function KanbanPage() {
  const [cards,    setCards]    = useState<KanbanCard[]>([])
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState<DateFilter>('all')
  const [loading,  setLoading]  = useState(true)
  const [dragId,   setDragId]   = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  // ─── fetch ──────────────────────────────────────────────────────────────────
  const fetchCards = useCallback(async (f: DateFilter) => {
    setLoading(true)
    const from = dateFrom(f)
    const qs = from ? `?view=kanban&date_from=${encodeURIComponent(from)}` : '?view=kanban'
    try {
      const data = await apiFetch<KanbanCard[]>(`/api/conversations${qs}`)
      setCards(data)
    } catch (err) {
      console.error('[kanban] fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCards(filter) }, [filter, fetchCards])

  // ─── métricas ───────────────────────────────────────────────────────────────
  const searchLower = search.toLowerCase()
  const filtered = cards.filter(
    (c) =>
      !search ||
      c.contact_name?.toLowerCase().includes(searchLower) ||
      c.contact_phone.includes(search) ||
      c.campaign_name?.toLowerCase().includes(searchLower)
  )

  const total      = filtered.length
  const converted  = filtered.filter((c) => c.status === 'converted').length
  const convRate   = total > 0 ? Math.round((converted / total) * 100) : 0
  const totalValue = filtered
    .filter((c) => c.status === 'converted')
    .reduce((s, c) => s + (c.sale_amount ?? 0), 0)

  // ─── drag & drop ────────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, cardId: string) {
    setDragId(cardId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(colId)
  }

  function handleDrop(e: React.DragEvent, newStatus: string) {
    e.preventDefault()
    if (!dragId || dragId === newStatus) { setDragId(null); setDragOver(null); return }

    // Actualización optimista
    setCards((prev) =>
      prev.map((c) => c.id === dragId ? { ...c, status: newStatus } : c)
    )

    apiFetch(`/api/conversations/${dragId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    }).catch((err) => {
      console.error('[kanban] status update:', err)
      fetchCards(filter) // revertir si falla
    })

    setDragId(null)
    setDragOver(null)
  }

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-100">Kanban</h1>
            <p className="text-xs text-gray-500">Pipeline de conversaciones</p>
          </div>

          <div className="flex items-center gap-2">
            {/* buscador */}
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5">
              <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contacto..."
                className="w-40 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
              />
            </div>

            {/* filtros de fecha */}
            <div className="flex rounded-lg bg-white/5 p-0.5">
              {(Object.keys(DATE_LABELS) as DateFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    filter === f ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {DATE_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* métricas */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          {[
            { label: 'Leads Totales',       value: loading ? '–' : String(total) },
            { label: 'Ventas',              value: loading ? '–' : String(converted) },
            { label: 'Tasa de Conversión',  value: loading ? '–' : `${convRate}%` },
            { label: 'Valor en Productos',  value: loading ? '–' : `$${totalValue.toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white/5 px-4 py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold text-gray-100 ${loading ? 'animate-pulse' : ''}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── tablero ── */}
      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((col) => {
          const colCards = filtered.filter((c) => c.status === col.id)
          const isOver   = dragOver === col.id

          return (
            <div
              key={col.id}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, col.id)}
              className={`flex w-64 shrink-0 flex-col rounded-xl transition-colors ${
                isOver ? `bg-white/5 ring-1 ${col.ring}` : 'bg-[#141414]'
              }`}
            >
              {/* header de columna */}
              <div className="flex items-center gap-2 px-3 py-3">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                <span className={`text-sm font-semibold ${col.header}`}>{col.label}</span>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-400">
                  {colCards.length}
                </span>
              </div>

              {/* cards */}
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
                {loading && colCards.length === 0 && (
                  <div className="rounded-lg bg-white/5 p-3 text-xs text-gray-600 animate-pulse">
                    Cargando...
                  </div>
                )}

                {colCards.map((card) => (
                  <KanbanCardItem
                    key={card.id}
                    card={card}
                    isDragging={dragId === card.id}
                    onDragStart={handleDragStart}
                    onDragEnd={() => { setDragId(null); setDragOver(null) }}
                  />
                ))}

                {/* zona drop vacía visible */}
                {isOver && colCards.length === 0 && (
                  <div className={`rounded-lg border-2 border-dashed border-current py-8 text-center text-xs ${col.header} opacity-40`}>
                    Soltar aquí
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── card individual ──────────────────────────────────────────────────────────
function KanbanCardItem({
  card,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  card:        KanbanCard
  isDragging:  boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragEnd:   () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.id)}
      onDragEnd={onDragEnd}
      className={`cursor-grab select-none rounded-xl bg-[#1e1e1e] p-3 ring-1 ring-white/5 transition-all active:cursor-grabbing ${
        isDragging ? 'opacity-40 scale-95' : 'hover:bg-[#242424] hover:ring-white/10'
      }`}
    >
      {/* fila superior: avatar + nombre */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
          {initials(card.contact_name, card.contact_phone)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-100">
            {card.contact_name ?? card.contact_phone}
          </p>
          {card.contact_name && (
            <p className="truncate text-[10px] text-gray-500">{card.contact_phone}</p>
          )}
        </div>
      </div>

      {/* campaña */}
      {card.campaign_name && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <svg className="h-3 w-3 shrink-0 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
          <span className="truncate text-[10px] text-violet-300">{card.campaign_name}</span>
        </div>
      )}

      {/* monto de venta */}
      {card.sale_amount != null && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <svg className="h-3 w-3 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
          <span className="text-[10px] font-semibold text-emerald-400">${card.sale_amount.toFixed(2)}</span>
        </div>
      )}

      {/* footer: tiempo */}
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-gray-600">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {timeAgo(card.last_message_at)}
        </div>
      </div>
    </div>
  )
}
