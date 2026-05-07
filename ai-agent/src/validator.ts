import 'dotenv/config'
import OpenAI from 'openai'
import { VoucherValidationResult } from './types'
import { VOUCHER_EXTRACTION_PROMPT } from './prompts'

interface ExtractedVoucher {
  is_payment_voucher: boolean
  amount: number | null
  reference: string | null
  bank: string | null
  date: string | null
}

// Usa DeepSeek si está disponible (soporta visión), OpenAI como fallback
function getVisionClient(): { client: OpenAI; model: string } {
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (deepseekKey) {
    return {
      client: new OpenAI({ apiKey: deepseekKey, baseURL: 'https://api.deepseek.com/v1' }),
      model: 'deepseek-chat',
    }
  }
  return {
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    model: 'gpt-4o',
  }
}

async function extractVoucherData(imageUrl: string): Promise<ExtractedVoucher> {
  const { client, model } = getVisionClient()

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VOUCHER_EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 300,
    })

    const raw = res.choices[0].message.content ?? '{}'
    // Extraer JSON aunque venga con texto adicional
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch ? jsonMatch[0] : raw
    return JSON.parse(jsonStr)
  } catch (err) {
    console.error('[validator] extractVoucherData error:', err)
    return { is_payment_voucher: false, amount: null, reference: null, bank: null, date: null }
  }
}

export async function validateVoucher(
  imageUrl: string,
  expectedAmount: number
): Promise<VoucherValidationResult> {
  const data = await extractVoucherData(imageUrl)

  if (!data.is_payment_voucher) {
    return {
      valid: false,
      amount: null,
      reference: null,
      bank: null,
      date: null,
      message: 'La imagen no parece ser un comprobante de pago. Por favor envía una foto clara de tu transferencia o QR escaneado. 📸',
    }
  }

  if (data.amount === null) {
    return {
      valid: false,
      amount: null,
      reference: data.reference,
      bank: data.bank,
      date: data.date,
      message: 'No pudimos leer el monto del comprobante. ¿Puedes enviarlo nuevamente con mejor resolución?',
    }
  }

  // Si no hay monto esperado (0), aceptar cualquier pago válido
  if (expectedAmount === 0) {
    return {
      valid: true,
      amount: data.amount,
      reference: data.reference,
      bank: data.bank,
      date: data.date,
      message: `✅ ¡Pago verificado! Recibimos Bs ${data.amount}${data.reference ? ` — Ref: ${data.reference}` : ''}. ¡Gracias! En breve procesamos tu pedido. 🎉`,
    }
  }

  // Tolerancia del 5% para diferencias de redondeo o comisiones
  const tolerance = expectedAmount * 0.05
  const amountMatches = Math.abs(data.amount - expectedAmount) <= tolerance

  if (!amountMatches) {
    return {
      valid: false,
      amount: data.amount,
      reference: data.reference,
      bank: data.bank,
      date: data.date,
      message: `El monto del comprobante (Bs ${data.amount}) no coincide con el precio (Bs ${expectedAmount}). Verifica que hayas enviado el monto correcto.`,
    }
  }

  return {
    valid: true,
    amount: data.amount,
    reference: data.reference,
    bank: data.bank,
    date: data.date,
    message: `✅ ¡Pago verificado! Recibimos Bs ${data.amount}${data.reference ? ` — Ref: ${data.reference}` : ''}. ¡Gracias! En breve procesamos tu pedido. 🎉`,
  }
}
