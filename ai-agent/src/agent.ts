import 'dotenv/config'
import OpenAI from 'openai'
import { AgentInput, AgentResponse, AgentIntent, ChatMessage } from './types'
import { buildSystemPrompt, INTENT_DETECTION_PROMPT } from './prompts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function detectIntent(message: string): Promise<{ intent: AgentIntent; confidence: number }> {
  const prompt = INTENT_DETECTION_PROMPT.replace('{message}', message)

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',     // modelo más barato para clasificación simple
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 60,
  })

  try {
    const raw = res.choices[0].message.content ?? '{}'
    const parsed = JSON.parse(raw)
    return {
      intent: parsed.intent ?? 'general',
      confidence: parsed.confidence ?? 0.5,
    }
  } catch {
    return { intent: 'general', confidence: 0.5 }
  }
}

export async function runAgent(input: AgentInput): Promise<AgentResponse> {
  const { incomingMessage, history, tenantPrompt, productName, productPrice } = input

  const { intent, confidence } = await detectIntent(incomingMessage)

  // Si el cliente envió un comprobante o pide hablar con humano, no generar respuesta IA
  if (intent === 'voucher') {
    return {
      reply: '¡Recibido! Estoy verificando tu comprobante de pago. En un momento te confirmo. 🙏',
      intent,
      confidence,
    }
  }

  if (intent === 'handoff') {
    return {
      reply: 'Entendido, voy a conectarte con un asesor que podrá ayudarte mejor. Un momento por favor. 👤',
      intent,
      confidence,
    }
  }

  const systemPrompt = buildSystemPrompt({
    tenantId: '',
    systemPrompt: tenantPrompt,
    productName: productName ?? 'Producto',
    productPrice: productPrice ?? 0,
    handoffThreshold: 0.4,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),               // últimos 10 mensajes para no exceder contexto
    { role: 'user', content: incomingMessage },
  ]

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.7,
    max_tokens: 300,
  })

  const reply = completion.choices[0].message.content?.trim() ?? 'No pude generar una respuesta.'

  return { reply, intent, confidence }
}
