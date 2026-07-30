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

export async function sendTypingIndicator(
  inboundMessageId?: string | null,
  creds?: TenantCredentials,
) {
  if (!inboundMessageId) return false

  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  if (!token || !phoneId) return false

  try {
    await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: inboundMessageId,
        typing_indicator: { type: 'text' },
      },
      { headers: makeHeaders(token) },
    )
    return true
  } catch (err: any) {
    const message = err?.response?.data?.error?.message || err?.message || 'unknown'
    console.warn(`[whatsapp] typing indicator skipped: ${message}`)
    return false
  }
}

function ensureClickableUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

export function formatWhatsAppText(input: string) {
  return String(input ?? '')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[^\s)]*)\)/gi,
      (_match, label: string, url: string) => `${label}: ${ensureClickableUrl(url)}`
    )
    .replace(
      /(^|[\s(])((?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>()]*)?)/gi,
      (_match, prefix: string, url: string) => `${prefix}${ensureClickableUrl(url)}`
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

// Contexto del tenant para envíos — se pasa por el webhook
export interface TenantCredentials {
  metaToken?:     string | null
  phoneNumberId?: string | null
}

// ─── Envío de mensajes de texto ──────────────────────────────────────────────
export async function sendTextMessage(to: string, body: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  const textBody = formatWhatsAppText(body)
  return axios.post(
    `${BASE_URL}/${phoneId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: textBody } },
    { headers: makeHeaders(token) }
  )
}

// ─── Envío de imágenes ───────────────────────────────────────────────────────
export async function sendImageMessage(to: string, imageUrl: string, caption?: string, creds?: TenantCredentials) {
  const { token, phoneId } = resolveCredentials(creds?.metaToken, creds?.phoneNumberId)
  const image: Record<string, string> = { link: imageUrl }
  if (caption) image.caption = formatWhatsAppText(caption)
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
  if (caption) video.caption = formatWhatsAppText(caption)
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
export async function downloadMediaAsDataUrl(mediaId: string, tenantToken?: string | null): Promise<string> {
  const token = tenantToken || process.env.META_TOKEN || ''
  const { data } = await axios.get(`${BASE_URL}/${mediaId}`, { headers: makeHeaders(token) })
  const downloadUrl: string = data.url
  const mimeType: string = data.mime_type ?? 'image/jpeg'

  const mediaRes = await axios.get<ArrayBuffer>(downloadUrl, {
    headers: makeHeaders(token),
    responseType: 'arraybuffer',
  })

  const base64 = Buffer.from(mediaRes.data).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

export async function downloadMediaBuffer(mediaId: string, tenantToken?: string | null): Promise<{
  buffer: Buffer
  mimeType: string
}> {
  const token = tenantToken || process.env.META_TOKEN || ''
  const { data } = await axios.get(`${BASE_URL}/${mediaId}`, { headers: makeHeaders(token) })
  const downloadUrl: string = data.url
  const mimeType: string = data.mime_type ?? 'application/octet-stream'

  const mediaRes = await axios.get<ArrayBuffer>(downloadUrl, {
    headers: makeHeaders(token),
    responseType: 'arraybuffer',
  })

  return { buffer: Buffer.from(mediaRes.data), mimeType }
}
