import { Router } from 'express'
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

  // 5. Guardar mensaje entrante
  const inboundContent = type === 'text' ? (raw.text as { body: string })?.body : `[${type}]`
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    type: type === 'image' ? 'image' : 'text',
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
        // Vincular flujo a la conversación
        await supabase.from('conversations')
          .update({ flow_id: matched.flow_id })
          .eq('id', conversation.id)
        console.log(`[webhook] Keyword "${matched.keyword}" → flow "${(matched.flows as any)?.name}"`)

        // Ejecutar flujo de bienvenida del keyword inmediatamente
        console.log(`[webhook] Executing keyword flow steps for "${(matched.flows as any)?.name}"`)
        await executeWelcomeFlow(matched.flow_id, from, conversation.id, tenantId)
        return  // El flujo inicial ya respondió — el AI responderá en el próximo mensaje
      }
    }
  }

  // 6b2. Buscar flujo activo (keyword tiene prioridad)
  const activeFlow: FlowInfo | null = keywordFlow ?? await getActiveFlow(tenantId)

  // 6c. Reiniciar temporizadores de inactividad (con reglas del flujo)
  resetInactivityTimers(conversation.id, from, activeFlow?.id, tenantId)

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
    await executeWelcomeFlow(activeFlow.id, from, conversation.id, tenantId)

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
    replyText = await handleImage(raw, contact.id, tenantId, conversation.id, from, creds)
  } else {
    replyText = await handleText(
      inboundContent ?? '',
      conversation.id,
      tenantId,
      activeFlow?.system_prompt ?? undefined,
      (activeFlow as any)?.model ?? 'gpt-4o'
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

  // 7g. Detectar descalificación → mover a kanban y desactivar IA
  const negativeKeywords = ['no me interesa', 'no quiero', 'no gracias', 'déjame en paz']
  const inboundLower = (inboundContent ?? '').toLowerCase()
  if (negativeKeywords.some(kw => inboundLower.includes(kw))) {
    console.log(`[webhook] Contact ${contact.id} disqualified, disabling AI`)
    await supabase.from('contacts').update({ kanban_stage: 'disqualified' }).eq('id', contact.id)
    await supabase.from('conversations').update({ ai_enabled: false }).eq('id', conversation.id)
    clearInactivityTimers(conversation.id)
  }
}

// ─── Manejo de mensajes de texto ─────────────────────────────────────────────
async function handleText(
  text: string,
  conversationId: string,
  tenantId: string,
  flowPrompt?: string,
  flowModel?: string,
): Promise<string> {
  const [history, tenant] = await Promise.all([getHistory(conversationId), getTenant(tenantId)])

  const result = await runAgent({
    contactPhone:    '',
    incomingMessage: text,
    history,
    tenantPrompt:    flowPrompt ?? DEFAULT_SYSTEM_PROMPT,
    productName:     tenant?.name,
    productPrice:    undefined,
    // Pasar modelo y claves del tenant al agente
    model:       flowModel ?? 'gpt-4o',
    apiKey:      (tenant as any)?.openai_key    ?? process.env.OPENAI_API_KEY,
    deepseekKey: (tenant as any)?.deepseek_key  ?? process.env.DEEPSEEK_API_KEY,
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
  creds?: { metaToken: string | null; phoneNumberId: string | null }
): Promise<string> {
  const image = raw.image as { id: string } | undefined
  if (!image?.id) return 'No pude procesar la imagen. ¿Puedes reenviarla?'

  // Descargar imagen de Meta y convertir a base64 para GPT-4o Vision
  let dataUrl: string
  try {
    dataUrl = await downloadMediaAsDataUrl(image.id)
  } catch {
    return 'Hubo un error al descargar tu imagen. Por favor reenvíala.'
  }

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
