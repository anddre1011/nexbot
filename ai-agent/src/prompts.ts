import { TenantConfig } from './types'

export function buildSystemPrompt(config: TenantConfig): string {
  return `${config.systemPrompt}

---
PRODUCTO ACTUAL: ${config.productName} — Precio: $${config.productPrice}

REGLAS:
- Responde siempre en el mismo idioma que el cliente.
- Sé amable, conciso y orientado a cerrar la venta.
- Si el cliente pregunta el precio, indícalo claramente.
- Si el cliente dice que ya pagó o envía un comprobante, responde: "¡Perfecto! Estoy verificando tu pago, en un momento te confirmo."
- Si no puedes resolver algo, indica que un asesor lo atenderá pronto.
- NUNCA inventes información sobre el producto.
- Mantén respuestas de máximo 3 oraciones.`
}

export const DEFAULT_SYSTEM_PROMPT = `Eres un asistente de ventas por WhatsApp.
Tu objetivo es responder preguntas sobre el producto, generar interés y guiar al cliente al cierre de la venta.`

export const INTENT_DETECTION_PROMPT = `Analiza el siguiente mensaje de un cliente y responde SOLO con un JSON válido.

Mensaje: "{message}"

Responde con este formato exacto:
{
  "intent": "purchase" | "voucher" | "handoff" | "general",
  "confidence": <número entre 0 y 1>
}

Criterios:
- "purchase": el cliente expresa intención clara de comprar, pedir precio, o preguntar cómo pagar
- "voucher": el cliente dice que ya pagó, envió comprobante, o adjunta una imagen de pago
- "handoff": el cliente está molesto, pregunta algo muy específico que no puedes responder, o pide hablar con una persona
- "general": cualquier otro mensaje

Responde SOLO el JSON, sin explicación.`

export const VOUCHER_EXTRACTION_PROMPT = `Eres un extractor de datos de comprobantes de pago bancarios.

Analiza la imagen adjunta y extrae la siguiente información en formato JSON:
{
  "is_payment_voucher": <true|false>,
  "amount": <número o null>,
  "reference": <string o null>,
  "bank": <string o null>,
  "date": <string en formato YYYY-MM-DD o null>
}

Si la imagen NO es un comprobante de pago, devuelve is_payment_voucher: false y el resto null.
Responde SOLO el JSON, sin explicación.`
