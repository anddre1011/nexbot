import axios from 'axios'

const BASE_URL = 'https://graph.facebook.com/v19.0'

function headers() {
  return { Authorization: `Bearer ${process.env.META_TOKEN}` }
}

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
