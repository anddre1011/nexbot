import { createClient } from './supabase/client'

const API = 'https://nexbot.pro'

async function getToken(): Promise<string> {
  const { data } = await createClient().auth.getSession()
  return data.session?.access_token ?? ''
}

export interface UploadResult {
  url:      string
  varName:  string
  variable: string   // {{media:varName}}
}

/**
 * Sube un archivo a Supabase Storage via /api/upload/flow-media,
 * guarda el registro en la tabla media, y devuelve la URL + variable.
 */
export async function uploadFlowMedia(
  file: File,
  suggestedName?: string
): Promise<UploadResult> {
  const token = await getToken()

  // 1. Subir a Storage
  const fd = new FormData()
  fd.append('file', file)

  const uploadRes = await fetch(`${API}/api/upload/flow-media`, {
    method:  'POST',
    body:    fd,
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}))
    throw new Error(err.error ?? `Upload failed ${uploadRes.status}`)
  }

  const { url } = await uploadRes.json() as { url: string }

  // 2. Generar nombre de variable limpio
  const base = suggestedName
    ?? file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
  const varName = (base.slice(0, 25) || `media_${Date.now().toString().slice(-4)}`)
  const variable = `{{media:${varName}}}`

  // 3. Guardar en tabla media para que resolveMediaTags lo encuentre
  const mediaType = file.type.startsWith('video/') ? 'video'
    : file.type.startsWith('audio/') ? 'audio'
    : file.type === 'application/pdf' ? 'document'
    : 'image'

  const saveRes = await fetch(`${API}/api/media`, {
    method:  'POST',
    body:    JSON.stringify({ name: varName, type: mediaType, url, variable }),
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!saveRes.ok) {
    const err = await saveRes.json().catch(() => ({}))
    console.error('[uploadFlowMedia] save error:', err)
    // No lanzar error — el archivo subió, solo no está en la tabla
  }

  return { url, varName, variable }
}
