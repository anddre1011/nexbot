'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

const DAYS = [
  { key: 'lunes',     label: 'Lunes' },
  { key: 'martes',    label: 'Martes' },
  { key: 'miercoles', label: 'Miércoles' },
  { key: 'jueves',    label: 'Jueves' },
  { key: 'viernes',   label: 'Viernes' },
  { key: 'sabado',    label: 'Sábado' },
  { key: 'domingo',   label: 'Domingo' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i.toString().padStart(2, '0')
  return [`${h}:00`, `${h}:30`]
}).flat()

interface DayConfig {
  start: string
  end: string
  enabled: boolean
}

type BusinessHours = Record<string, DayConfig>

const DEFAULT_HOURS: BusinessHours = Object.fromEntries(
  DAYS.map(d => [d.key, { start: '06:00', end: '23:00', enabled: true }])
)

export default function HorariosPage() {
  const [hours, setHours]   = useState<BusinessHours>(DEFAULT_HOURS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  useEffect(() => {
    apiFetch<BusinessHours | null>('/api/tenants/business-hours')
      .then(data => { if (data) setHours(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function updateDay(dayKey: string, patch: Partial<DayConfig>) {
    setHours(prev => ({ ...prev, [dayKey]: { ...prev[dayKey], ...patch } }))
    setSaved(false)
  }

  function applyToAll() {
    const ref = hours['lunes']
    setHours(prev => {
      const next = { ...prev }
      for (const d of DAYS) next[d.key] = { ...ref, enabled: prev[d.key].enabled }
      return next
    })
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true); setSaved(false)
    try {
      await apiFetch('/api/tenants/business-hours', {
        method: 'PUT',
        body: JSON.stringify({ business_hours: hours }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert('Error al guardar: ' + (err instanceof Error ? err.message : 'desconocido'))
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 pt-12 text-sm text-gray-600 justify-center">
        <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
          className="h-5 w-5 animate-spin rounded-full opacity-60" />
        Cargando horarios...
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl py-8 px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <span>🕐</span> Horarios de Operación
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Define los horarios en que NexBot puede enviar mensajes de inactividad y seguimiento.
          Fuera de estos horarios, no se enviarán mensajes automáticos.
        </p>
      </div>

      {/* Info */}
      <div style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)' }}
        className="rounded-xl px-4 py-3 text-xs text-blue-300 mb-6">
        ℹ️ Los horarios se basan en la zona horaria de Bolivia (UTC-4). Los mensajes de inactividad
        configurados en el Constructor IA solo se enviarán dentro de estos horarios.
      </div>

      {/* Aplicar a todos */}
      <div className="flex justify-end mb-3">
        <button onClick={applyToAll}
          style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/20 transition-colors">
          📋 Aplicar horario del Lunes a todos
        </button>
      </div>

      {/* Grid de días */}
      <div className="flex flex-col gap-2">
        {DAYS.map(({ key, label }) => {
          const day = hours[key]
          return (
            <div key={key}
              style={{
                background: day.enabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                border: `1px solid ${day.enabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}`,
                opacity: day.enabled ? 1 : 0.5,
              }}
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all">

              {/* Toggle */}
              <button
                onClick={() => updateDay(key, { enabled: !day.enabled })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${day.enabled ? 'bg-indigo-600' : 'bg-white/10'}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${day.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>

              {/* Día */}
              <span className={`text-sm font-semibold w-24 ${day.enabled ? 'text-gray-200' : 'text-gray-600'}`}>
                {label}
              </span>

              {/* Horarios */}
              {day.enabled ? (
                <div className="flex items-center gap-2 flex-1">
                  <select value={day.start}
                    onChange={e => updateDay(key, { start: e.target.value })}
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}
                    className="rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 outline-none">
                    {HOURS.map(h => <option key={h} value={h} className="bg-[#1a1a1a]">{h}</option>)}
                  </select>

                  <span className="text-xs text-gray-600">a</span>

                  <select value={day.end}
                    onChange={e => updateDay(key, { end: e.target.value })}
                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
                    className="rounded-lg px-2.5 py-1.5 text-xs text-red-300 outline-none">
                    {HOURS.map(h => <option key={h} value={h} className="bg-[#1a1a1a]">{h}</option>)}
                  </select>

                  <span className="ml-auto text-[10px] text-gray-600">
                    {(() => {
                      const [sh, sm] = day.start.split(':').map(Number)
                      const [eh, em] = day.end.split(':').map(Number)
                      const diff = (eh * 60 + em) - (sh * 60 + sm)
                      const hours = Math.floor(diff / 60)
                      const mins = diff % 60
                      return diff > 0 ? `${hours}h${mins ? ` ${mins}m` : ''}` : '—'
                    })()}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-gray-600 italic">Deshabilitado — no se enviarán mensajes</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Save */}
      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          style={{ background: saving ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
          className="rounded-xl px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all">
          {saving ? 'Guardando...' : 'Guardar horarios'}
        </button>

        {saved && (
          <span className="text-sm text-emerald-400 animate-pulse">
            ✓ Horarios guardados
          </span>
        )}
      </div>
    </div>
  )
}
