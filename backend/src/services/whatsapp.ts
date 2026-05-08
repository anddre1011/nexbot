import axios from 'axios'

const BASE_URL = 'https://graph.facebook.com/v25.0'

// Credenciales: usa las del tenant si existen, sino las del env (compatibilidad)
function resolveCredentials(tenantToken?: string | null, tenantPhoneId?: string | null) {
  const token       = tenantToken   || process.env.META_TOKEN       || ''
  const phoneId     = tenantPhoneId || process.env.META_PHONE_NUMBER_ID || ''
  return { token, phoneId }
}

function makeHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

// Contexto del tenant para envíos — se pasa por el webhook
export interface TenantCredentials {
  metaToken?:     string | null
  phoneNumberId?: string | null
}

// ─── Envío de mensajes de texto ──────────────────────────────────────────────
export async function sendTextMessage(to: string, body: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de imágenes ───────────────────────────────────────────────────────
export async function sendImageMessage(to: string, imageUrl: string, caption?: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  const image: Record<string, string> = { link: imageUrl }
  if (caption) image.caption = caption
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'image', image },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de videos ─────────────────────────────────────────────────────────
export async function sendVideoMessage(to: string, videoUrl: string, caption?: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  const video: Record<string, string> = { link: videoUrl }
  if (caption) video.caption = caption
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'video', video },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de audio ──────────────────────────────────────────────────────────
export async function sendAudioMessage(to: string, audioUrl: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'audio', audio: { link: audioUrl } },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de documentos ─────────────────────────────────────────────────────
export async function sendDocumentMessage(to: string, docUrl: string, filename: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'document', document: { link: docUrl, filename } },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de plantilla ──────────────────────────────────────────────────────
export async function sendTemplateMessage(to: string, templateName: string, langCode = 'es', creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: langCode } } },
    { headers: makeHeaders(token) }
  )
}

// ─── Helper: enviar cualquier tipo de media por tipo ─────────────────────────
export async function sendMediaByType(
  to: string,
  type: 'image' | 'video' | 'audio' | 'document',
  url: string,
  caption?: string,
  creds?: TenantCredentials
) {
  switch (type) {
    case 'image':    return sendImageMessage(to, url, caption, creds)
    case 'video':    return sendVideoMessage(to, url, caption, creds)
    case 'audio':    return sendAudioMessage(to, url, creds)
    case 'document': return sendDocumentMessage(to, url, caption ?? 'document', creds)
  }
}

// Descarga un media de Meta y lo devuelve como data URL base64.
// GPT-4o Vision acepta data URLs directamente sin necesidad de subir a Storage.
export async function downloadMediaAsDataUrl(mediaId: string): Promise<string> {
  // 1. Obtener URL de descarga
  const fallbackToken = process.env.META_TOKEN || ''
  const { data } = await axios.get(`${BASE_URL}/${mediaId}`, { headers: makeHeaders(fallbackToken) })
  const downloadUrl: string = data.url
  const mimeType: string = data.mime_type ?? 'image/jpeg'

  // 2. Descargar bytes con auth header
  const imageRes = await axios.get<ArrayBuffer>(downloadUrl, {
    headers: makeHeaders(fallbackToken),
    responseType: 'arraybuffer',
  })

  const base64 = Buffer.from(imageRes.data).toString('base64')
  return `data:${mimeType};base64,${base64}`
}
