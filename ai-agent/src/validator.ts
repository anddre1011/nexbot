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

// Prioridad de modelos con visión:
// 1. Gemini Flash (gratis, excelente para recibos)
// 2. OpenAI GPT-4o (si tiene saldo)
// 3. Sin visión → aceptar imagen directamente
function getVisionClient(): { client: OpenAI; model: string } | null {
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    return {
      client: new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }),
      model: 'gemini-2.0-flash',
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model: 'gpt-4o',
    }
  }

  return null  // Sin modelo de visión disponible
}

async function extractVoucherData(imageUrl: string): Promise<ExtractedVoucher> {
  const vision = getVisionClient()

  if (!vision) {
    console.warn('[validator] No vision model configured — accepting image without verification')
    return { is_payment_voucher: true, amount: null, reference: null, bank: null, date: null }
  }

  const { client, model } = vision
  console.log(`[validator] Analyzing image with ${model}`)

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
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch ? jsonMatch[0] : raw
    const result = JSON.parse(jsonStr)
    console.log(`[validator] Result: is_voucher=${result.is_payment_voucher} amount=${result.amount}`)
    return result
  } catch (err: any) {
    console.error('[validator] Vision error:', err?.status, err?.message)
    // 402 = sin saldo → aceptar para no bloquear al cliente
    return { is_payment_voucher: true, amount: null, reference: null, bank: null, date: null }
  }
}

export async function validateVoucher(
  imageUrl: string,
  expectedAmount: number
): Promise<VoucherValidationResult> {
  const data = await extractVoucherData(imageUrl)

  if (!data.is_payment_voucher) {
    return { valid: false, isVoucher: false, amount: null, reference: null, bank: null, date: null, message: '' }
  }

  if (data.amount === null) {
    return {
      valid: false, isVoucher: true,
      amount: null, reference: data.reference, bank: data.bank, date: data.date,
      message: 'No pudimos leer el monto del comprobante. ¿Puedes enviarlo nuevamente con mejor resolución?',
    }
  }

  if (expectedAmount === 0) {
    return {
      valid: true, isVoucher: true,
      amount: data.amount, reference: data.reference, bank: data.bank, date: data.date,
      message: `✅ ¡Pago verificado! Recibimos Bs ${data.amount}${data.reference ? ` — Ref: ${data.reference}` : ''}. ¡Gracias! En breve procesamos tu pedido. 🎉`,
    }
  }

  const tolerance = expectedAmount * 0.05
  const amountMatches = Math.abs(data.amount - expectedAmount) <= tolerance

  if (!amountMatches) {
    return {
      valid: false, isVoucher: true,
      amount: data.amount, reference: data.reference, bank: data.bank, date: data.date,
      message: `El monto del comprobante (Bs ${data.amount}) no coincide con el precio (Bs ${expectedAmount}). Verifica que hayas enviado el monto correcto.`,
    }
  }

  // VALIDACIÓN DE FECHA (Bolivia time)
  if (data.date) {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/La_Paz' }))
    const todayStr = today.toISOString().split('T')[0]
    
    // Calcular ayer
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Solo aceptar pagos de hoy o ayer máximo
    if (data.date !== todayStr && data.date !== yesterdayStr) {
      return {
        valid: false, isVoucher: true,
        amount: data.amount, reference: data.reference, bank: data.bank, date: data.date,
        message: `El comprobante tiene fecha de ${data.date}. Solo se aceptan pagos realizados hoy. Por favor, realiza el pago actual o envía el comprobante correcto.`,
      }
    }
  }

  return {
    valid: true, isVoucher: true,
    amount: data.amount, reference: data.reference, bank: data.bank, date: data.date,
    message: `✅ ¡Pago verificado! Recibimos Bs ${data.amount}${data.reference ? ` — Ref: ${data.reference}` : ''}. ¡Gracias! En breve procesamos tu pedido. 🎉`,
  }
}
