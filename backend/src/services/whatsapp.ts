import axios from 'axios'

const BASE_URL = 'https://graph.facebook.com/v25.0'

function headers() {
  return { Authorization: `Bearer ${process.env.META_TOKEN}` }
}

// ─── Envío de mensajes de texto ──────────────────────────────────────────────
export async function sendTextMessage(to: string, body: string) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
    { headers: headers() }
  )
}

// ─── Envío de imágenes ───────────────────────────────────────────────────────
export async function sendImageMessage(to: string, imageUrl: string, caption?: string) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  const image: Record<string, string> = { link: imageUrl }
  if (caption) image.caption = caption
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image,
    },
    { headers: headers() }
  )
}

// ─── Envío de videos ─────────────────────────────────────────────────────────
export async function sendVideoMessage(to: string, videoUrl: string, caption?: string) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  const video: Record<string, string> = { link: videoUrl }
  if (caption) video.caption = caption
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video,
    },
    { headers: headers() }
  )
}

// ─── Envío de audio ──────────────────────────────────────────────────────────
export async function sendAudioMessage(to: string, audioUrl: string) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio: { link: audioUrl },
    },
    { headers: headers() }
  )
}

// ─── Envío de documentos ─────────────────────────────────────────────────────
export async function sendDocumentMessage(to: string, docUrl: string, filename: string) {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { link: docUrl, filename },
    },
    { headers: headers() }
  )
}

// ─── Envío de plantilla ──────────────────────────────────────────────────────
export async function sendTemplateMessage(to: string, templateName: string, langCode = 'es') {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  return axios.post(
    `${BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: langCode } },
    },
    { headers: headers() }
  )
}

// ─── Helper: enviar cualquier tipo de media por tipo ─────────────────────────
export async function sendMediaByType(
  to: string,
  type: 'image' | 'video' | 'audio' | 'document',
  url: string,
  caption?: string
) {
  switch (type) {
    case 'image':    return sendImageMessage(to, url, caption)
    case 'video':    return sendVideoMessage(to, url, caption)
    case 'audio':    return sendAudioMessage(to, url)
    case 'document': return sendDocumentMessage(to, url, caption ?? 'document')
  }
}

// Descarga un media de Meta y lo devuelve como data URL base64.
// GPT-4o Vision acepta data URLs directamente sin necesidad de subir a Storage.
export async function downloadMediaAsDataUrl(mediaId: string): Promise<string> {
  // 1. Obtener URL de descarga
  const { data } = await axios.get(`${BASE_URL}/${mediaId}`, { headers: headers() })
  const downloadUrl: string = data.url
  const mimeType: string = data.mime_type ?? 'image/jpeg'

  // 2. Descargar bytes con auth header
  const imageRes = await axios.get<ArrayBuffer>(downloadUrl, {
    headers: headers(),
    responseType: 'arraybuffer',
  })

  const base64 = Buffer.from(imageRes.data).toString('base64')
  return `data:${mimeType};base64,${base64}`
}
