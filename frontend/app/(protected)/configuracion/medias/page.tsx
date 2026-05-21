'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { apiFetch } from '@/lib/api'
import { optimizeUploadFile } from '@/lib/media-compress'

interface Media { id: string; name: string; type: string; url: string; size_bytes: number | null; folder: string; variable: string | null; created_at: string }

const TYPE_ICON: Record<string, string> = { image: '🖼️', video: '🎬', audio: '🎙️', document: '📄' }

function fmtSize(bytes: number | null) {
  if (!bytes) return '–'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

function mimeToType(mime: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

export default function MediasPage() {
  const [media,     setMedia]     = useState<Media[]>([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [folder,    setFolder]    = useState('General')
  const [copied,    setCopied]    = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchMedia = useCallback(async () => {
    setLoading(true)
    try { setMedia(await apiFetch<Media[]>('/api/media')) }
    catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchMedia() }, [fetchMedia])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      const supabase = createClient()
      for (const file of files) {
        const uploadFile = await optimizeUploadFile(file)
        const ext    = uploadFile.name.split('.').pop()
        const clean  = uploadFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_')
        const path   = `${folder}/${Date.now()}_${clean}.${ext}`
        const { error: upErr } = await supabase.storage.from('media').upload(path, uploadFile, { cacheControl: '31536000' })
        if (upErr) { console.error(upErr); continue }
        const { data } = supabase.storage.from('media').getPublicUrl(path)
        await apiFetch('/api/media', {
          method: 'POST',
          body: JSON.stringify({
            name: uploadFile.name, type: mimeToType(uploadFile.type),
            url: data.publicUrl, size_bytes: uploadFile.size,
            folder, variable: `{{media:${clean}}}`,
          }),
        })
      }
      await fetchMedia()
    } catch (err) { console.error(err) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function handleDelete(item: Media) {
    if (!confirm(`¿Eliminar "${item.name}"?`)) return
    try {
      await apiFetch(`/api/media/${item.id}`, { method: 'DELETE' })
      setMedia((p) => p.filter((m) => m.id !== item.id))
      alert('Eliminado correctamente')
    } catch (err) {
      alert('Error al eliminar: ' + (err instanceof Error ? err.message : 'desconocido'))
    }
  }

  async function handleRename(item: Media, newName: string) {
    if (!newName.trim() || newName === item.name) return
    const clean = newName.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    const variable = `{{media:${clean}}}`
    try {
      await apiFetch(`/api/media/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName.trim(), variable }),
      })
      setMedia((p) => p.map((m) => m.id === item.id ? { ...m, name: newName.trim(), variable } : m))
    } catch (err) {
      alert('Error al renombrar: ' + (err instanceof Error ? err.message : 'desconocido'))
    }
  }

  function copyVariable(v: string) {
    navigator.clipboard.writeText(v)
    setCopied(v)
    setTimeout(() => setCopied(null), 2000)
  }

  const folders = [...new Set(media.map((m) => m.folder))]

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Medias</h2>
          <p className="mt-1 text-sm text-gray-500">Archivos para usar en tus flujos y mensajes</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={folder} onChange={(e) => setFolder(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
            className="rounded-xl px-3 py-2 text-xs text-gray-300 outline-none focus:border-violet-500">
            {[...new Set(['General', ...folders])].map((f) => <option key={f} className="bg-[#1a1a1a]">{f}</option>)}
            <option value="__new__" className="bg-[#1a1a1a]">+ Nueva carpeta</option>
          </select>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf" className="hidden" onChange={handleUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ background: uploading ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50">
            {uploading ? 'Subiendo...' : '↑ Upload'}
          </button>
        </div>
      </div>

      {loading ? (
        <PageLoading />
      ) : media.length === 0 ? (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(255,255,255,0.06)' }}
          className="flex flex-col items-center gap-4 rounded-2xl py-20 text-center">
          <span className="text-5xl">🖼️</span>
          <p className="text-sm text-gray-600">Sin archivos aún — sube tu primera media</p>
          <button onClick={() => fileRef.current?.click()}
            style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">
            Subir archivo
          </button>
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          className="rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <tr className="text-left text-xs font-bold uppercase tracking-widest text-gray-600">
                <th className="px-5 py-3">Archivo</th>
                <th className="px-5 py-3">Carpeta</th>
                <th className="px-5 py-3">Tamaño</th>
                <th className="px-5 py-3">Variable</th>
                <th className="px-5 py-3">Fecha</th>
                <th className="px-5 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {media.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg shrink-0">{TYPE_ICON[item.type] ?? '📄'}</span>
                      <div className="min-w-0">
                        <input
                          defaultValue={item.name}
                          onBlur={(e) => handleRename(item, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                          style={{ background: 'transparent', border: 'none', outline: 'none' }}
                          className="text-sm font-medium text-gray-200 truncate max-w-[160px] hover:bg-white/5 focus:bg-white/10 rounded px-1 cursor-text transition-colors"
                        />
                        <p className="text-[10px] text-gray-600 uppercase px-1">{item.type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{item.folder}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{fmtSize(item.size_bytes)}</td>
                  <td className="px-5 py-3">
                    {item.variable && (
                      <button onClick={() => copyVariable(item.variable!)}
                        style={{ background: copied === item.variable ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.12)', border: `1px solid ${copied === item.variable ? 'rgba(16,185,129,0.3)' : 'rgba(124,58,237,0.25)'}` }}
                        className={`rounded-lg px-2 py-0.5 font-mono text-[10px] transition-colors ${copied === item.variable ? 'text-emerald-400' : 'text-violet-300 hover:bg-violet-500/20'}`}>
                        {copied === item.variable ? '✓ Copiado' : item.variable}
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{fmtDate(item.created_at)}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => handleDelete(item)}
                      className="rounded p-1.5 text-gray-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PageLoading() {
  return <div className="flex items-center gap-3 text-sm text-gray-600 pt-8"><div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }} className="h-5 w-5 animate-spin rounded-full opacity-60" />Cargando...</div>
}
