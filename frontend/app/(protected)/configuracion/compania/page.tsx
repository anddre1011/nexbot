'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'

const TIMEZONES = ['America/La_Paz', 'America/Lima', 'America/Bogota', 'America/Santiago', 'America/Buenos_Aires', 'America/Mexico_City', 'America/New_York', 'Europe/Madrid']
const LANGUAGES = [{ v: 'es', l: 'Español' }, { v: 'en', l: 'English' }, { v: 'pt', l: 'Português' }]

interface CompanyForm { name: string; logo_url: string; timezone: string; language: string }

export default function CompaniaPage() {
  const [form,      setForm]      = useState<CompanyForm>({ name: '', logo_url: '', timezone: 'America/La_Paz', language: 'es' })
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch<CompanyForm & { name: string }>('/api/tenants/settings')
      .then((d) => {
        if (d) setForm({
          name:      (d as { name?: string }).name ?? '',
          logo_url:  (d as { logo_url?: string }).logo_url ?? '',
          timezone:  (d as { timezone?: string }).timezone ?? 'America/La_Paz',
          language:  (d as { language?: string }).language ?? 'es',
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `logos/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('media').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('media').getPublicUrl(path)
      setForm((p) => ({ ...p, logo_url: data.publicUrl }))
    } catch (err) { console.error(err) }
    finally { setUploading(false) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await apiFetch('/api/tenants/settings', { method: 'PUT', body: JSON.stringify(form) })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  if (loading) return <PageLoading />

  return (
    <div className="max-w-2xl">
      <PageHeader title="Compañía" sub="Información general de tu negocio" />

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        className="rounded-2xl p-6 flex flex-col gap-6">

        {/* Logo */}
        <div>
          <label className="mb-3 block text-xs font-bold uppercase tracking-widest text-gray-500">Logo del negocio</label>
          <div className="flex items-center gap-4">
            <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logo_url} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                className="rounded-xl px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40">
                {uploading ? 'Subiendo...' : '📁 Subir logo'}
              </button>
              {form.logo_url && (
                <button onClick={() => setForm((p) => ({ ...p, logo_url: '' }))}
                  className="text-xs text-gray-600 hover:text-red-400 transition-colors">
                  Eliminar
                </button>
              )}
            </div>
          </div>
        </div>

        <DField label="Nombre del negocio" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Mi Negocio Online" />

        {/* Zona horaria */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Zona horaria</label>
          <select value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
            className="w-full rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20">
            {TIMEZONES.map((tz) => <option key={tz} value={tz} className="bg-[#1a1a1a]">{tz}</option>)}
          </select>
        </div>

        {/* Idioma */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Idioma</label>
          <div className="flex gap-2">
            {LANGUAGES.map(({ v, l }) => (
              <button key={v} onClick={() => setForm((p) => ({ ...p, language: v }))}
                style={form.language === v ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.2))', border: '1px solid rgba(124,58,237,0.5)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${form.language === v ? 'text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && <span className="text-xs text-emerald-400">✓ Guardado</span>}
          <SaveButton saving={saving} onSave={handleSave} />
        </div>
      </div>
    </div>
  )
}

function DField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
        className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" />
    </div>
  )
}
function SaveButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <button onClick={onSave} disabled={saving}
      style={{ background: saving ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
      className="rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50">
      {saving ? 'Guardando...' : 'Guardar cambios'}
    </button>
  )
}
function PageHeader({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-6"><h2 className="text-xl font-bold text-white">{title}</h2><p className="mt-1 text-sm text-gray-500">{sub}</p></div>
}
function PageLoading() {
  return <div className="flex items-center gap-3 text-sm text-gray-600 pt-8"><div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} className="h-5 w-5 animate-spin rounded-full opacity-60" />Cargando...</div>
}
