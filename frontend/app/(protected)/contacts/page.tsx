'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Contact {
  id:              string
  phone:           string
  name:            string | null
  status:          'active' | 'blocked' | 'unsubscribed'
  ai_enabled:      boolean
  tags:            string[]
  last_message_at: string | null
  created_at:      string
  campaign_id:     string | null
  campaign_name:   string | null
  kanban_status:   string | null
  total_value:     number
}

interface Campaign { id: string; name: string }

type StatusFilter = '' | 'active' | 'blocked' | 'unsubscribed'
type KanbanFilter = '' | 'human' | 'attending' | 'converted' | 'disqualified' | 'abandoned'
type ViewTab = 'list' | 'cleanup'

const STATUS_BADGE: Record<string, string> = {
  active:        'bg-emerald-500/15 text-emerald-400',
  blocked:       'bg-red-500/15 text-red-400',
  unsubscribed:  'bg-gray-500/15 text-gray-400',
}

const KANBAN_LABEL: Record<string, string> = {
  human: 'Humano', attending: 'En Atención', converted: 'Convertido',
  disqualified: 'Descalificado', abandoned: 'Abandono',
}

function initials(name: string | null, phone: string) {
  if (name) return name.slice(0, 2).toUpperCase()
  return phone.slice(-2)
}

function fmtDate(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function exportCSV(contacts: Contact[]) {
  const header = ['Nombre', 'Teléfono', 'Campaña', 'Valor (BOB)', 'Estado', 'Kanban', 'Fecha Registro']
  const rows   = contacts.map((c) => [
    c.name ?? '',
    c.phone,
    c.campaign_name ?? '',
    c.total_value.toFixed(2),
    c.status,
    c.kanban_status ?? '',
    fmtDate(c.created_at),
  ])
  const csv  = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a'); a.href = url; a.download = 'contactos.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function ContactsPage() {
  const [contacts,   setContacts]   = useState<Contact[]>([])
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([])
  const [search,     setSearch]     = useState('')
  const [statusF,    setStatusF]    = useState<StatusFilter>('')
  const [campaignF,  setCampaignF]  = useState('')
  const [kanbanF,    setKanbanF]    = useState<KanbanFilter>('')
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<Contact | null>(null)
  const [showAdd,    setShowAdd]     = useState(false)
  const [viewTab,    setViewTab]    = useState<ViewTab>('list')
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<string | null>(null)

  // ─── fetch ──────────────────────────────────────────────────────────────────
  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (statusF)   qs.set('status',      statusF)
    if (campaignF) qs.set('campaign_id', campaignF)
    if (kanbanF)   qs.set('kanban',      kanbanF)
    if (search)    qs.set('search',      search)
    try {
      const data = await apiFetch<Contact[]>(`/api/contacts?${qs}`)
      setContacts(data)
    } catch (err) { console.error('[contacts]', err) }
    finally { setLoading(false) }
  }, [statusF, campaignF, kanbanF, search])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  useEffect(() => {
    apiFetch<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => {})
  }, [])

  // ─── métricas ───────────────────────────────────────────────────────────────
  const totalValue = contacts.reduce((s, c) => s + c.total_value, 0)

  // ─── toggle AI ──────────────────────────────────────────────────────────────
  async function toggleAI(contact: Contact) {
    const next = !contact.ai_enabled
    setContacts((prev) => prev.map((c) => c.id === contact.id ? { ...c, ai_enabled: next } : c))
    if (selected?.id === contact.id) setSelected((p) => p ? { ...p, ai_enabled: next } : p)
    try {
      await apiFetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH', body: JSON.stringify({ ai_enabled: next }),
      })
    } catch { fetchContacts() }
  }

  // ─── delete ──────────────────────────────────────────────────────────────────
  async function deleteContact(id: string) {
    if (!confirm('¿Eliminar este contacto?')) return
    await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' })
    setContacts((prev) => prev.filter((c) => c.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  async function cleanupContacts() {
    const message = 'Esto borrara chats y contactos que no compraron. Los compradores quedan guardados, pero sin historial de chat. Escribe ELIMINAR para confirmar.'
    const confirmText = window.prompt(message)
    if (confirmText !== 'ELIMINAR') return

    setCleanupLoading(true)
    setCleanupResult(null)
    try {
      const result = await apiFetch<{
        buyers_kept: number
        buyer_chats_deleted: number
        contacts_deleted: number
      }>('/api/contacts/cleanup', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'ELIMINAR' }),
      })
      setCleanupResult(`Listo: ${result.contacts_deleted} contactos borrados, ${result.buyers_kept} compradores conservados y ${result.buyer_chats_deleted} chats de compradores limpiados.`)
      setSelected(null)
      fetchContacts()
    } catch (err) {
      setCleanupResult(err instanceof Error ? err.message : 'No se pudo limpiar contactos')
    } finally {
      setCleanupLoading(false)
    }
  }

  // ─── importar CSV ────────────────────────────────────────────────────────────
  const importRef = useRef<HTMLInputElement>(null)

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = (ev.target?.result as string) ?? ''
      const lines = text.split('\n').slice(1).filter(Boolean)
      for (const line of lines) {
        const cols  = line.split(',').map((v) => v.replace(/^"|"$/g, '').trim())
        const phone = cols[1] ?? cols[0]
        const name  = cols[0] !== phone ? cols[0] : undefined
        if (!phone) continue
        await apiFetch('/api/contacts', {
          method: 'POST', body: JSON.stringify({ phone, name }),
        }).catch(() => {})
      }
      fetchContacts()
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ─── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden bg-[#0f0f0f] text-gray-100">
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* ── barra superior ── */}
        <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-4">
              <h1 className="text-xl font-bold text-gray-100">Contactos</h1>
              <span className="text-sm text-gray-500">
                {loading ? '…' : contacts.length} contactos
              </span>
              <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-400">
                BOB {totalValue.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="mr-2 flex rounded-lg border border-white/10 bg-white/5 p-1">
                <button
                  onClick={() => setViewTab('list')}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${viewTab === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Lista
                </button>
                <button
                  onClick={() => setViewTab('cleanup')}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${viewTab === 'cleanup' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  Limpieza
                </button>
              </div>
              <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
              <button
                onClick={() => importRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                Importar CSV
              </button>
              <button
                onClick={() => exportCSV(contacts)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Exportar CSV
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Agregar Contacto
              </button>
            </div>
          </div>

          {/* ── filtros ── */}
          <div className={`${viewTab === 'list' ? 'mt-3 flex' : 'hidden'} flex-wrap items-center gap-2`}>
            {/* buscador */}
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5">
              <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nombre o teléfono..."
                className="w-44 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
              />
            </div>

            {/* status */}
            <Select value={statusF} onChange={(v) => setStatusF(v as StatusFilter)} label="Status">
              <option value="">Todos los estados</option>
              <option value="active">Activo</option>
              <option value="blocked">Bloqueado</option>
              <option value="unsubscribed">No suscrito</option>
            </Select>

            {/* campaña */}
            <Select value={campaignF} onChange={setCampaignF} label="Campaña">
              <option value="">Todas las campañas</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>

            {/* kanban */}
            <Select value={kanbanF} onChange={(v) => setKanbanF(v as KanbanFilter)} label="Kanban">
              <option value="">Todos los stages</option>
              {Object.entries(KANBAN_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>

            {(statusF || campaignF || kanbanF || search) && (
              <button
                onClick={() => { setStatusF(''); setCampaignF(''); setKanbanF(''); setSearch('') }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                × Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── tabla ── */}
        {viewTab === 'cleanup' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-2xl rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-5">
              <p className="text-sm font-semibold text-red-200">Eliminar contactos de prueba y limpiar chats</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                Esta accion borra todos los contactos que no tienen ventas confirmadas. Los compradores se conservan
                para ventas/reportes, pero se eliminan sus conversaciones y mensajes para dejar limpio el inbox.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={cleanupContacts}
                  disabled={cleanupLoading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {cleanupLoading ? 'Limpiando...' : 'Limpiar y conservar compradores'}
                </button>
                <span className="text-xs text-gray-500">Requiere escribir ELIMINAR.</span>
              </div>
              {cleanupResult && (
                <p className="mt-4 rounded-lg bg-black/25 px-3 py-2 text-xs text-gray-300">{cleanupResult}</p>
              )}
            </div>
          </div>
        )}

        <div className={viewTab === 'list' ? 'flex-1 overflow-auto' : 'hidden'}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#141414] text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">WhatsApp</th>
                <th className="px-4 py-3">Campaña</th>
                <th className="px-4 py-3">Kanban</th>
                <th className="px-4 py-3 text-right">Valor (BOB)</th>
                <th className="px-4 py-3">Registro</th>
                <th className="px-4 py-3 text-center">IA</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="py-16 text-center text-gray-600 text-xs">Cargando...</td></tr>
              )}
              {!loading && contacts.length === 0 && (
                <tr><td colSpan={9} className="py-16 text-center text-gray-600 text-xs">Sin contactos con estos filtros</td></tr>
              )}
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-white/[0.03] ${selected?.id === c.id ? 'bg-white/[0.05]' : ''}`}
                >
                  {/* avatar */}
                  <td className="px-4 py-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold">
                      {initials(c.name, c.phone)}
                    </div>
                  </td>

                  {/* nombre + status */}
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-100">{c.name ?? '–'}</p>
                    <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[c.status]}`}>
                      {c.status}
                    </span>
                  </td>

                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{c.phone}</td>

                  <td className="px-4 py-2.5 text-xs text-violet-300">
                    {c.campaign_name ?? <span className="text-gray-600">–</span>}
                  </td>

                  <td className="px-4 py-2.5">
                    {c.kanban_status ? (
                      <span className="rounded px-1.5 py-0.5 text-[10px] bg-white/5 text-gray-400">
                        {KANBAN_LABEL[c.kanban_status] ?? c.kanban_status}
                      </span>
                    ) : <span className="text-gray-600 text-xs">–</span>}
                  </td>

                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-400">
                    {c.total_value > 0 ? c.total_value.toFixed(2) : <span className="text-gray-600 font-normal">0.00</span>}
                  </td>

                  <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(c.created_at)}</td>

                  {/* toggle IA */}
                  <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleAI(c)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.ai_enabled ? 'bg-indigo-600' : 'bg-white/10'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${c.ai_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>

                  {/* delete */}
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => deleteContact(c.id)}
                      className="rounded p-1 text-gray-600 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ panel lateral ══ */}
      {selected && (
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/5 bg-[#141414]">
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <p className="text-sm font-semibold text-gray-100">Detalle del contacto</p>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="p-4 flex flex-col gap-4">
            {/* avatar + nombre */}
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold">
                {initials(selected.name, selected.phone)}
              </div>
              <p className="font-semibold text-gray-100">{selected.name ?? 'Sin nombre'}</p>
              <p className="font-mono text-xs text-gray-500">{selected.phone}</p>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[selected.status]}`}>
                {selected.status}
              </span>
            </div>

            <Divider />

            {/* datos */}
            <div className="flex flex-col gap-2.5 text-xs">
              <PanelRow label="Campaña"   value={selected.campaign_name ?? '–'} />
              <PanelRow label="Kanban"    value={selected.kanban_status ? (KANBAN_LABEL[selected.kanban_status] ?? selected.kanban_status) : '–'} />
              <PanelRow label="Valor"     value={`BOB ${selected.total_value.toFixed(2)}`} highlight={selected.total_value > 0} />
              <PanelRow label="Registro"  value={fmtDate(selected.created_at)} />
              <PanelRow label="Últ. msg"  value={fmtDate(selected.last_message_at)} />
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Agente IA</span>
                <button
                  onClick={() => toggleAI(selected)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${selected.ai_enabled ? 'bg-indigo-600' : 'bg-white/10'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${selected.ai_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            {/* tags */}
            {selected.tags.length > 0 && (
              <>
                <Divider />
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Etiquetas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((t) => (
                      <span key={t} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">{t}</span>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Divider />

            {/* acciones */}
            <div className="flex gap-2">
              <a
                href={`/chat`}
                className="flex-1 rounded-lg bg-emerald-600/10 py-2 text-center text-xs font-medium text-emerald-400 hover:bg-emerald-600/20"
              >
                Ver chat
              </a>
              <button
                onClick={() => deleteContact(selected.id)}
                className="flex-1 rounded-lg bg-red-500/10 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20"
              >
                Eliminar
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* ══ modal agregar contacto ══ */}
      {showAdd && (
        <AddContactModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); fetchContacts() }}
        />
      )}
    </div>
  )
}

// ─── modal agregar contacto ───────────────────────────────────────────────────
function AddContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name,    setName]    = useState('')
  const [phone,   setPhone]   = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim()) { setError('El teléfono es obligatorio'); return }
    setLoading(true); setError('')
    try {
      await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || undefined, phone: phone.trim() }),
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear contacto')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-[#1a1a1a] p-6 shadow-2xl ring-1 ring-white/10">
        <h2 className="text-base font-semibold text-gray-100">Agregar contacto</h2>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <ModalField label="Nombre (opcional)" value={name} onChange={setName} placeholder="Juan Pérez" />
          <ModalField label="Teléfono (E.164)" value={phone} onChange={setPhone} placeholder="+591 7XXXXXXX" required />
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-gray-400 hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {loading ? 'Creando...' : 'Crear contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── componentes pequeños ─────────────────────────────────────────────────────
function Select({ value, onChange, label, children }: {
  value: string; onChange: (v: string) => void; label: string; children: React.ReactNode
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-300 outline-none focus:ring-1 focus:ring-indigo-500"
    >
      {children}
    </select>
  )
}

function PanelRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? 'font-semibold text-emerald-400' : 'text-gray-300'}>{value}</span>
    </div>
  )
}

function Divider() {
  return <hr className="border-white/5" />
}

function ModalField({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}
