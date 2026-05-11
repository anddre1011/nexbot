import 'dotenv/config'
import OpenAI from 'openai'
import { AgentInput, AgentResponse, AgentIntent, ChatMessage } from './types'
import { buildSystemPrompt, INTENT_DETECTION_PROMPT } from './prompts'

// Determina si el modelo es de DeepSeek
function isDeepSeek(model: string) {
  return model.startsWith('deepseek') // deepseek-v4-pro, deepseek-v4-flash, deepseek-chat, deepseek-reasoner
}

// Crea el cliente correcto según el modelo y las claves disponibles
function getClient(model: string, apiKey?: string, deepseekKey?: string): { client: OpenAI; resolvedModel: string } {
  if (isDeepSeek(model) && deepseekKey) {
    return {
      client: new OpenAI({ apiKey: deepseekKey, baseURL: 'https://api.deepseek.com/v1' }),
      resolvedModel: model,
    }
  }
  // Fallback: OpenAI
  const key = apiKey || process.env.OPENAI_API_KEY || ''
  return {
    client: new OpenAI({ apiKey: key }),
    resolvedModel: model.startsWith('deepseek') ? 'gpt-4o-mini' : model, // si no hay deepseek key, usa mini
  }
}

async function detectIntent(message: string, openaiKey?: string): Promise<{ intent: AgentIntent; confidence: number }> {
  const prompt = INTENT_DETECTION_PROMPT.replace('{message}', message)
  const key = openaiKey || process.env.OPENAI_API_KEY || ''
  const client = new OpenAI({ apiKey: key })

  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 60,
    })
    const raw = res.choices[0].message.content ?? '{}'
    const parsed = JSON.parse(raw)
    return { intent: parsed.intent ?? 'general', confidence: parsed.confidence ?? 0.5 }
  } catch {
    return { intent: 'general', confidence: 0.5 }
  }
}

export async function runAgent(input: AgentInput): Promise<AgentResponse> {
  const {
    incomingMessage, history, tenantPrompt, productName, productPrice,
    model: requestedModel, apiKey, deepseekKey, onLowCredits,
  } = input as AgentInput & { model?: string; apiKey?: string; deepseekKey?: string; onLowCredits?: () => void }

  const model = requestedModel ?? 'gpt-4o'

  const { intent, confidence } = await detectIntent(incomingMessage, apiKey)

  if (intent === 'voucher') {
    return { reply: '¡Recibido! Estoy verificando tu comprobante de pago. En un momento te confirmo. 🙏', intent, confidence }
  }

  const systemPrompt = buildSystemPrompt({
    tenantId: '', systemPrompt: tenantPrompt,
    productName: productName ?? 'Producto', productPrice: productPrice ?? 0, handoffThreshold: 0.4,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: incomingMessage },
  ]

  const { client, resolvedModel } = getClient(model, apiKey, deepseekKey)

  try {
    const completion = await client.chat.completions.create({
      model: resolvedModel,
      messages,
      temperature: 0.7,
      max_tokens: 400,
    })

    const reply = completion.choices[0].message.content?.trim()
    if (!reply) {
      console.error(`[agent] Empty reply from ${resolvedModel}`)
      return { reply: '¡Hola! Estoy aquí para ayudarte. ¿En qué te puedo asistir? 😊', intent, confidence }
    }
    return { reply, intent, confidence }
  } catch (err: any) {
    const code = err?.status ?? err?.code ?? ''
    console.error(`[agent] API error (${resolvedModel}):`, code, err?.message ?? err)

    if (code === 402 || String(err?.message).includes('Insufficient Balance') || String(err?.message).includes('insufficient_quota')) {
      onLowCredits?.()
      return { reply: 'En este momento estoy con problemas técnicos. Por favor escríbeme en unos minutos. 🙏', intent, confidence }
    }
    return { reply: '¡Hola! ¿En qué te puedo ayudar hoy? 😊', intent, confidence }
  }
}
