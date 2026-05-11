import { Router } from 'express'
import OpenAI, { toFile } from 'openai'
import { supabase } from '../services/supabase'
import { sendTextMessage, sendMediaByType, downloadMediaAsDataUrl } from '../services/whatsapp'
import { resetInactivityTimers, clearInactivityTimers } from '../services/inactivity'
import { resolveCampaign, linkConversationToCampaign, propagateCampaignToSale } from '../services/campaigns'
import {
  executeWelcomeFlow,
  executeConversionFlow,
  detectFunctionCalls,
  resolveMediaTags,
  getActiveFlow,
} from '../services/flow-engine'
import { runAgent } from '../../../ai-agent/src/agent'
import { validateVoucher } from '../../../ai-agent/src/validator'
import { createNotification } from '../services/notifications'
import { DEFAULT_SYSTEM_PROMPT } from '../../../ai-agent/src/prompts'
import type { ChatMessage } from '../../../ai-agent/src/types'

const router = Router()

// ─── Verificación de webhook Meta ────────────────────────────────────────────
router.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge)
    return
  }
  res.sendStatus(403)
})

// ─── Mensajes entrantes ───────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  console.log('[webhook] REQ RECEIVED:', JSON.stringify(req.body, null, 2))
  // Meta exige 200 inmediato o reintenta
  res.sendStatus(200)

  const value    = req.body?.entry?.[0]?.changes?.[0]?.value
  const messages = value?.messages
  if (!messages?.length) return

  const raw           = messages[0]
  const from          = raw.from as string
  const type          = raw.type as string
  const phoneNumberId = value?.metadata?.phone_number_id as string | undefined

  // Buscar tenant por phone_number_id (multi-tenant) o fallback a TENANT_ID (single)
  let tenantId: string | undefined

  if (phoneNumberId) {
    const { data } = await supabase
      .from('tenants')
      .select('id')
      .eq('phone_number_id', phoneNumberId)
      .eq('active', true)
      .maybeSingle()
    tenantId = data?.id
    console.log(`[webhook] Tenant lookup: phone_number_id="${phoneNumberId}" → tenant="${tenantId ?? 'NOT FOUND'}"`)
  }

  if (!tenantId) {
    tenantId = process.env.TENANT_ID
  }

  // FALLBACK DE EMERGENCIA: Si no encontró por ID ni hay ENV, agarrar el único tenant activo
  if (!tenantId) {
    console.warn(`[webhook] No tenant found for phone_number_id="${phoneNumberId}". Using fallback...`)
    const { data } = await supabase
      .from('tenants')
      .select('id')
      .eq('active', true)
      .limit(1)
      .single()
    tenantId = data?.id
  }

  if (!tenantId) {
    console.error(`[webhook] CRITICAL: No active tenant found in database!`)
    return
  }

  try {
    await processMessage({ from, type, raw, tenantId })
  } catch (err) {
    console.error('[webhook] unhandled error:', err)
  }
})

// ─── Pipeline principal ───────────────────────────────────────────────────────
async function processMessage(params: {
  from: string
  type: string
  raw: Record<string, unknown>
  tenantId: string
}) {
  const { from, type, raw, tenantId } = params

  // Obtener credenciales Meta del tenant para todos los envíos
  const tenantData = await getTenant(tenantId)
  const creds = {
    metaToken:     (tenantData as any)?.meta_token     || null,
    phoneNumberId: (tenantData as any)?.phone_number_id || null,
  }

  // 1. Upsert contacto
  const contact = await upsertContact(from, tenantId)

  // 2. Extraer campaña del referral de Meta (solo presente en primer mensaje del click)
  const { campaignId } = await resolveCampaign(raw, tenantId)

  // 3. Obtener o crear conversación abierta
  const conversation = await getOrCreateConversation(contact.id, tenantId)
  const isNewConversation = conversation._new === true

  // 4. Vincular campaña si la conversación aún no tiene una asignada
  if (campaignId) {
    await linkConversationToCampaign(conversation.id, campaignId)
  }

  // 5. Guardar mensaje entrante (transcribir audio si aplica)
  let inboundContent: string
  if (type === 'text') {
    inboundContent = (raw.text as { body: string })?.body ?? ''
  } else if (type === 'audio') {
    const audioId = (raw.audio as { id?: string } | undefined)?.id
    inboundContent = audioId
      ? await transcribeAudio(audioId, creds.metaToken)
      : '[Audio recibido]'
    console.log(`[webhook] Audio transcribed: "${inboundContent}"`)
  } else {
    inboundContent = `[${type}]`
  }

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    type: type === 'image' ? 'image' : type === 'audio' ? 'audio' : 'text',
    content: inboundContent,
  })

  // 6a. Actualizar last_message_at del contacto
  await supabase
    .from('contacts')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', contact.id)

  // 6b. Detectar palabra clave y asignar flujo correspondiente
  type FlowInfo = { id: string; name: string; type: string; model: string; system_prompt: string | null }
  let keywordFlow: FlowInfo | null = null
  if (type === 'text' && inboundContent) {
    // Normalizar acentos: "máster" === "master", "información" === "informacion"
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const msgNorm = norm(inboundContent)

    const { data: keywords } = await supabase
      .from('keywords')
      .select('keyword, flow_id, flows(id, name, type, model, system_prompt)')
      .eq('tenant_id', tenantId)
      .eq('active', true)

    if (keywords?.length) {
      const matched = keywords.find(k =>
        msgNorm.includes(norm(k.keyword)) || msgNorm === norm(k.keyword)
      )
      if (matched?.flow_id && matched.flows) {
        keywordFlow = matched.flows as unknown as FlowInfo
        
        // Ejecutar flujo inicial SOLO si es un flujo distinto al actual o si la conversa estaba inactiva/cerrada
        const isSameFlow = conversation.flow_id === matched.flow_id;
        const isActiveSession = ['bot', 'human'].includes(conversation.status);

        if (!isSameFlow || !isActiveSession) {
          // Vincular flujo nuevo a la conversación
          await supabase.from('conversations')
            .update({ flow_id: matched.flow_id, status: 'bot' })
            .eq('id', conversation.id)
          
          console.log(`[webhook] Keyword "${matched.keyword}" → executing flow "${(matched.flows as any)?.name}"`)
          await executeWelcomeFlow(matched.flow_id, from, conversation.id, tenantId, creds)
          return  // El flujo inicial ya respondió
        } else {
          console.log(`[webhook] Keyword "${matched.keyword}" ignored because conversation is already in this flow. AI will handle it.`)
        }
      }
    }
  }

  // 6b2. Buscar flujo activo (keyword tiene prioridad)
  const activeFlow: FlowInfo | null = keywordFlow ?? await getActiveFlow(tenantId)

  // 6c. Reiniciar temporizadores de inactividad (con reglas del flujo)
  resetInactivityTimers(conversation.id, from, activeFlow?.id, tenantId, creds)

  // ═══ 7. LÓGICA DE FLUJO ═══════════════════════════════════════════════════

  // 7a. Si es conversación nueva y hay flujo con welcome steps → ejecutar flujo de bienvenida
  if (isNewConversation && activeFlow && activeFlow.type === 'conversational_ai') {
    console.log(`[webhook] New conversation — executing welcome flow "${activeFlow.name}"`)

    // Vincular flujo a la conversación
    await supabase
      .from('conversations')
      .update({ flow_id: activeFlow.id, flow_step: 0 })
      .eq('id', conversation.id)

    // Ejecutar secuencia de bienvenida
    await executeWelcomeFlow(activeFlow.id, from, conversation.id, tenantId, creds)

    // Incrementar ejecuciones del flujo
    try {
      await supabase.rpc('increment_flow_executions', { p_flow_id: activeFlow.id })
    } catch {
      await supabase.from('flows')
        .update({ executions: (activeFlow as any).executions + 1 })
        .eq('id', activeFlow.id)
    }

    return // No procesar con IA en el primer mensaje, el flujo ya respondió
  }

  // 7b. Verificar si la IA está habilitada para esta conversación
  if (!conversation.ai_enabled) {
    console.log(`[webhook] AI disabled for conversation ${conversation.id}, skipping`)
    return // No responder — IA desactivada (contacto convertido o descalificado)
  }

  // 7c. Procesar según tipo de mensaje
  let replyText: string

  if (type === 'image') {
    replyText = await handleImage(
      raw, contact.id, tenantId, conversation.id, from, creds,
      activeFlow?.system_prompt ?? undefined,
      (contact as any)?.name ?? null,
    )
  } else {
    // Audio (ya transcrito) y texto pasan igual por la IA
    replyText = await handleText(
      inboundContent ?? '',
      conversation.id,
      tenantId,
      activeFlow?.system_prompt ?? undefined,
      (activeFlow as any)?.model ?? 'gpt-4o',
      (contact as any)?.name ?? null,
      from
    )
  }

  // 7d. Detectar {{function:X}} en la respuesta de la IA
  const { cleaned, functions } = detectFunctionCalls(replyText)

  if (functions.length > 0 && activeFlow) {
    console.log(`[webhook] Function calls detected: ${functions.join(', ')}`)

    for (const fn of functions) {
      const success = await executeConversionFlow(
        activeFlow.id,
        fn,
        contact.id,
        from,
        conversation.id,
        tenantId,
        creds,
      )

      if (success) {
        // Si la conversión fue exitosa, limpiar timers y no enviar el texto limpio
        clearInactivityTimers(conversation.id)
        return // SILENCIO ABSOLUTO — el flujo de conversión ya respondió
      }
    }
  }

  // 7e. Detectar {{media:X}} en la respuesta y enviar multimedia
  const { parts } = await resolveMediaTags(cleaned || replyText, tenantId)

  if (parts.length > 1 || (parts.length === 1 && parts[0].type !== 'text')) {
    // Enviar partes multimedia por separado
    for (const part of parts) {
      if (part.type === 'text') {
        if (part.content.trim()) {  // nunca enviar texto vacío
          await sendTextMessage(from, part.content, creds)
          await saveOutbound(conversation.id, 'text', part.content)
        }
      } else if (part.content.trim()) {
        await sendMediaByType(from, part.type, part.content, undefined, creds)
        await saveOutbound(conversation.id, part.type, `[${part.type}]`)
      }
    }
  } else {
    // Mensaje de texto simple — solo enviar si no está vacío
    const finalText = (parts[0]?.content || cleaned || replyText || '').trim()
    if (finalText) {
      await sendTextMessage(from, finalText, creds)
      await saveOutbound(conversation.id, 'text', finalText)
    } else {
      console.warn('[webhook] Agent returned empty reply, skipping send')
    }
  }

  // 7f. Si el agente detecta handoff → marcar conversación como 'human'
  if (replyText.toLowerCase().includes('asesor') || replyText.toLowerCase().includes('humano')) {
    await supabase
      .from('conversations')
      .update({ status: 'human' })
      .eq('id', conversation.id)
    clearInactivityTimers(conversation.id)
  }

  // 7g. Detectar descalificación → kanban disqualified + desactivar IA
  const disqualifyKeywords = [
    'no me interesa', 'no quiero', 'no gracias', 'déjame en paz',
    'es una estafa', 'es un engaño', 'es estafa', 'es engaño',
    'estafa', 'fraude', 'engaño', 'mentira', 'mentiras',
    'no necesito', 'basta', 'para de escribir', 'no me escribas',
    'no me molestes', 'me molesta', 'me tiene harto', 'spameando',
    'no me interesa para nada', 'paso', 'no paso', 'no compro',
    'reportar', 'voy a reportar', 'es falso', 'fake',
  ]
  const inboundNorm = (inboundContent ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (disqualifyKeywords.some(kw => inboundNorm.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))) {
    console.log(`[webhook] Contact ${contact.id} disqualified`)
    await Promise.all([
      supabase.from('contacts').update({ kanban_stage: 'disqualified' }).eq('id', contact.id),
      supabase.from('conversations').update({ status: 'disqualified', ai_enabled: false }).eq('id', conversation.id),
    ])
    clearInactivityTimers(conversation.id)
    createNotification({ tenantId, type: 'disqualification', title: '❌ Contacto descalificado', body: `${from} no estaba interesado`, data: { phone: from } }).catch(() => {})
  }
}

// ─── Transcribir audio con Whisper ───────────────────────────────────────────
async function transcribeAudio(mediaId: string, tenantToken?: string | null): Promise<string> {
  const token = tenantToken || process.env.META_TOKEN || ''
  try {
    const dataUrl = await downloadMediaAsDataUrl(mediaId, token)
    const base64 = dataUrl.split(',')[1]
    if (!base64) return '[Audio recibido]'
    const buffer = Buffer.from(base64, 'base64')

    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      console.warn('[transcribeAudio] No OPENAI_API_KEY — cannot transcribe')
      return '[Audio recibido — no se pudo transcribir]'
    }

    const openai = new OpenAI({ apiKey: openaiKey })
    const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' })
    const result = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'es' })
    console.log(`[transcribeAudio] "${result.text}"`)
    return result.text || '[Audio sin contenido]'
  } catch (err: any) {
    console.error('[transcribeAudio] error:', err.message)
    return '[Audio recibido]'
  }
}

// ─── Respuesta visual a imagen no-voucher ────────────────────────────────────
async function handleImageVision(
  dataUrl: string,
  conversationId: string,
  tenantId: string,
  flowPrompt?: string,
  contactName?: string | null,
  contactPhone?: string,
): Promise<string> {
  try {
    const [history, tenant] = await Promise.all([getHistory(conversationId), getTenant(tenantId)])
    const resolvedPrompt = resolvePromptVars(flowPrompt ?? DEFAULT_SYSTEM_PROMPT, contactName ?? null, contactPhone ?? '')
    const openaiKey = (tenant as any)?.openai_key ?? process.env.OPENAI_API_KEY
    if (!openaiKey) return 'Recibí tu imagen. ¿En qué te puedo ayudar?'

    const openai = new OpenAI({ apiKey: openaiKey })
    const msgs: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: resolvedPrompt },
      ...(history.slice(-6) as OpenAI.ChatCompletionMessageParam[]),
      { role: 'user', content: [
        { type: 'text', text: '[El cliente envió una imagen]' },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
      ]},
    ]
    const res = await openai.chat.completions.create({ model: 'gpt-4o', messages: msgs, max_tokens: 300 })
    return res.choices[0]?.message?.content?.trim() ?? 'Gracias por la imagen.'
  } catch (err: any) {
    console.error('[handleImageVision] error:', err.message)
    return 'Recibí tu imagen. ¿En qué te puedo ayudar?'
  }
}

// ─── Resolutor de variables del prompt ───────────────────────────────────────
function resolvePromptVars(
  prompt: string,
  contactName: string | null,
  contactPhone: string
): string {
  // Hora de Bolivia (UTC-4)
  const now = new Date()
  const boliviaTime = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  const hour = boliviaTime.getUTCHours()

  const saludo = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const diaSemana = dias[boliviaTime.getUTCDay()]

  const horaActual = `${String(boliviaTime.getUTCHours()).padStart(2,'0')}:${String(boliviaTime.getUTCMinutes()).padStart(2,'0')}`

  const nombre = contactName || contactPhone

  return prompt
    .replace(/\{\{nombre\}\}/g,      nombre)
    .replace(/\{\{telefono\}\}/g,    contactPhone)
    .replace(/\{\{hora_actual\}\}/g, horaActual)
    .replace(/\{\{dia_semana\}\}/g,  diaSemana)
    .replace(/\{\{saludo\}\}/g,      saludo)
}

// ─── Manejo de mensajes de texto ─────────────────────────────────────────────
async function handleText(
  text: string,
  conversationId: string,
  tenantId: string,
  flowPrompt?: string,
  flowModel?: string,
  contactName?: string | null,
  contactPhone?: string,
): Promise<string> {
  const [history, tenant] = await Promise.all([getHistory(conversationId), getTenant(tenantId)])

  // Resolver variables del prompt con datos reales del contacto
  const resolvedPrompt = resolvePromptVars(
    flowPrompt ?? DEFAULT_SYSTEM_PROMPT,
    contactName ?? null,
    contactPhone ?? ''
  )

  const result = await runAgent({
    contactPhone:    contactPhone ?? '',
    incomingMessage: text,
    history,
    tenantPrompt:    resolvedPrompt,
    productName:     tenant?.name,
    productPrice:    undefined,
    model:       flowModel ?? 'gpt-4o',
    apiKey:      (tenant as any)?.openai_key    ?? process.env.OPENAI_API_KEY,
    deepseekKey: (tenant as any)?.deepseek_key  ?? process.env.DEEPSEEK_API_KEY,
    onLowCredits: () => {
      createNotification({ tenantId, type: 'low_credits', title: '⚠️ Créditos de IA agotados', body: 'Tu saldo de OpenAI/DeepSeek está vacío. Recarga para continuar.', data: { model: flowModel } }).catch(() => {})
    },
  } as any)

  return result.reply
}

// ─── Manejo de imágenes (comprobantes) ───────────────────────────────────────
async function handleImage(
  raw: Record<string, unknown>,
  contactId: string,
  tenantId: string,
  conversationId: string,
  contactPhone: string = '',
  creds?: { metaToken: string | null; phoneNumberId: string | null },
  flowPrompt?: string,
  contactName?: string | null,
): Promise<string> {
  const image = raw.image as { id: string } | undefined
  if (!image?.id) return 'No pude procesar la imagen. ¿Puedes reenviarla?'

  let dataUrl: string
  try {
    dataUrl = await downloadMediaAsDataUrl(image.id, creds?.metaToken)
  } catch {
    return 'Hubo un error al descargar tu imagen. Por favor reenvíala.'
  }

  // Si la imagen NO es un comprobante → que la IA la vea y responda con visión
  // (se determina más abajo tras validateVoucher)

  // Buscar venta pendiente del contacto para saber el monto esperado
  const { data: pendingSale } = await supabase
    .from('sales')
    .select('id, amount')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const expectedAmount = pendingSale?.amount ?? 0

  const validation = await validateVoucher(dataUrl, expectedAmount)

  // Si no es comprobante → la IA ve la imagen y responde con visión
  if (!validation.isVoucher) {
    return handleImageVision(dataUrl, conversationId, tenantId, flowPrompt, contactName, contactPhone)
  }

  if (validation.valid) {
    // Confirmar venta pendiente si existe, o crear nueva
    if (pendingSale?.id) {
      await supabase.from('sales').update({ status: 'confirmed' }).eq('id', pendingSale.id)
      await propagateCampaignToSale(pendingSale.id, conversationId)
    }

    // Buscar flujo activo para ejecutar su conversión
    const activeFlow = await getActiveFlow(tenantId)
    if (activeFlow) {
      const { data: conversions } = await supabase
        .from('flow_conversions').select('*').eq('flow_id', activeFlow.id).limit(1)

      const conversion = conversions?.[0]

      // Obtener producto vinculado al flujo
      let productName = 'Producto'
      let productPrice = validation.amount ?? 0
      if (conversion?.product_id) {
        const { data: prod } = await supabase
          .from('products').select('name, price').eq('id', conversion.product_id).single()
        if (prod) { productName = prod.name; productPrice = prod.price }
      }

      // Crear registro de venta en la tabla sales
      if (!pendingSale?.id) {
        const { data: newSale } = await supabase.from('sales').insert({
          tenant_id:  tenantId,
          contact_id: contactId,
          product:    productName,
          amount:     productPrice,
          status:     'confirmed',
        }).select('id').single()
        if (newSale?.id) {
          await propagateCampaignToSale(newSale.id, conversationId)
        }
        console.log(`[webhook] Sale created: ${productName} Bs${productPrice} for contact ${contactId}`)
        createNotification({ tenantId, type: 'sale', title: '💰 Nueva venta', body: `${productName} — Bs ${productPrice}`, data: { amount: productPrice, product: productName } }).catch(() => {})
      }

      if (conversion) {
        const kanbanStage = conversion.kanban_stage ?? 'converted'
        await supabase.from('conversations')
          .update({ status: kanbanStage, ai_enabled: !conversion.disable_ai })
          .eq('id', conversationId)

        // Entregar producto si está configurado
        if (conversion.delivery_enabled && conversion.product_id) {
          const { data: product } = await supabase
            .from('products').select('delivery_url, name').eq('id', conversion.product_id).single()
          if (product?.delivery_url) {
            const deliveryMsg = `🎉 ¡Acceso habilitado! Aquí está tu enlace:\n${product.delivery_url}`
            await sendTextMessage(contactPhone, deliveryMsg, creds)
            await saveOutbound(conversationId, 'text', deliveryMsg)
          }
        }

        if (conversion.confirm_message?.trim()) {
          await sendTextMessage(contactPhone, conversion.confirm_message, creds)
          await saveOutbound(conversationId, 'text', conversion.confirm_message)
        }

        console.log(`[webhook] Conversion triggered: ${kanbanStage}`)
        clearInactivityTimers(conversationId)
        return validation.message
      }
    }

    // Sin flujo → crear venta genérica y mover a convertido
    if (!pendingSale?.id) {
      await supabase.from('sales').insert({
        tenant_id: tenantId, contact_id: contactId,
        product: 'Venta', amount: validation.amount ?? 0, status: 'confirmed',
      })
    }
    await supabase.from('conversations').update({ status: 'converted' }).eq('id', conversationId)
    clearInactivityTimers(conversationId)
    console.log(`[webhook] Payment validated for contact ${contactId}`)
  }

  return validation.message
}

// ─── Helpers de base de datos ─────────────────────────────────────────────────
async function upsertContact(phone: string, tenantId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .upsert({ tenant_id: tenantId, phone }, { onConflict: 'tenant_id,phone' })
    .select('id, phone')
    .single()

  if (error) throw new Error(`upsertContact: ${error.message}`)
  return data
}

async function getOrCreateConversation(contactId: string, tenantId: string) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, status, ai_enabled, flow_id, flow_step')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .in('status', ['open', 'bot'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) return { ...existing, _new: false }

  const { data, error } = await supabase
    .from('conversations')
    .insert({ tenant_id: tenantId, contact_id: contactId, status: 'bot' })
    .select('id, status, ai_enabled, flow_id, flow_step')
    .single()

  if (error) throw new Error(`getOrCreateConversation: ${error.message}`)
  return { ...data, _new: true }
}

async function getHistory(conversationId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(6) // 6 mensajes = 3 intercambios — suficiente contexto, menos tokens

  return (data ?? [])
    .filter((m) => m.content)
    .map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content as string,
    }))
}

async function getTenant(tenantId: string) {
  const { data } = await supabase
    .from('tenants')
    .select('name, openai_key, deepseek_key, meta_token, phone_number_id')
    .eq('id', tenantId)
    .single()
  return data
}

async function saveOutbound(conversationId: string, type: string, content: string) {
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    type,
    content,
  })
}

export default router
