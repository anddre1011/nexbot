import 'dotenv/config'
import OpenAI from 'openai'
import { VoucherValidationResult } from './types'
import { VOUCHER_EXTRACTION_PROMPT } from './prompts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface ExtractedVoucher {
  is_payment_voucher: boolean
  amount: number | null
  reference: string | null
  bank: string | null
  date: string | null
}

async function extractVoucherData(imageUrl: string): Promise<ExtractedVoucher> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
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
    max_tokens: 200,
  })

  try {
    const raw = res.choices[0].message.content ?? '{}'
    return JSON.parse(raw)
  } catch {
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
      message: 'La imagen no parece ser un comprobante de pago. Por favor envía una foto clara de tu comprobante.',
    }
  }

  if (data.amount === null) {
    return {
      valid: false,
      amount: null,
      reference: data.reference,
      bank: data.bank,
      date: data.date,
      message: 'No pudimos leer el monto del comprobante. ¿Puedes enviarlo nuevamente con mejor iluminación?',
    }
  }

  // Tolerancia del 1% para diferencias de redondeo o comisiones bancarias
  const tolerance = expectedAmount * 0.01
  const amountMatches = Math.abs(data.amount - expectedAmount) <= tolerance

  if (!amountMatches) {
    return {
      valid: false,
      amount: data.amount,
      reference: data.reference,
      bank: data.bank,
      date: data.date,
      message: `El monto del comprobante ($${data.amount}) no coincide con el precio del producto ($${expectedAmount}). Verifica que hayas enviado el monto correcto.`,
    }
  }

  return {
    valid: true,
    amount: data.amount,
    reference: data.reference,
    bank: data.bank,
    date: data.date,
    message: `✅ Pago verificado. Recibimos $${data.amount}${data.reference ? ` — Ref: ${data.reference}` : ''}. ¡Gracias! En breve procesamos tu pedido.`,
  }
}
