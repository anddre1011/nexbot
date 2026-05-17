import { Router } from 'express'
import OpenAI, { toFile } from 'openai'
import { supabase } from '../services/supabase'
import { sendTextMessage, sendMediaByType, downloadMediaAsDataUrl, downloadMediaBuffer } from '../services/whatsapp'
import { resetInactivityTimers, clearInactivityTimers } from '../services/inactivity'
import { resolveCampaign, linkConversationToCampaign, propagateCampaignToSale } from '../services/campaigns'
import {
  executeWelcomeFlow,
  executeConversionFlow,
  detectFunctionCalls,
  resolveMediaTags,
  getActiveFlow,
  getFlowById,
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
  const { campaignId, metaAdId } = await resolveCampaign(raw, tenantId)

  // 3. Obtener o crear conversación abierta
  const conversation = await getOrCreateConversation(contact.id, tenantId)
  const isNewConversation = conversation._new === true
  const blockedStages = ['converted', 'closed', 'disqualified', 'abandoned']
  const alreadyConverted = blockedStages.includes((contact as { kanban_stage?: string | null }).kanban_stage ?? '')

  // 4. Vincular campaña si la conversación aún no tiene una asignada
  if (campaignId) {
    await linkConversationToCampaign(conversation.id, campaignId)
  }

  const adFlow = metaAdId && !alreadyConverted
    ? await getAutomationFlowByAdId(tenantId, metaAdId)
    : null
  if (adFlow) {
    if (!isNewConversation) {
      console.log(`[webhook] Ad flow "${adFlow.name}" ignored because conversation already exists.`)
    } else {
      await supabase.from('conversations')
        .update({ flow_id: adFlow.id, status: 'bot', ai_enabled: true, flow_step: 0 })
        .eq('id', conversation.id)

      await supabase.from('automation_campaigns')
        .update({ executions: ((adFlow as any).executions ?? 0) + 1 })
        .eq('id', adFlow.automation_campaign_id)

      console.log(`[webhook] Meta ad ${metaAdId} -> executing flow "${adFlow.name}"`)
      await executeWelcomeFlow(adFlow.id, from, conversation.id, tenantId, creds)
      return
    }
  }

  // 5. Guardar mensaje entrante (transcribir audio si aplica)
  let inboundContent: string
  let storedContent: string
  let storedType: string = 'text'
  if (type === 'text') {
    inboundContent = (raw.text as { body: string })?.body ?? ''
    storedContent = inboundContent
  } else if (type === 'audio') {
    const audioId = (raw.audio as { id?: string } | undefined)?.id
    inboundContent = audioId
      ? await transcribeAudio(audioId, creds.metaToken)
      : '[Audio recibido]'
    storedContent = inboundContent
    storedType = 'audio'
    console.log(`[webhook] Audio transcribed: "${inboundContent}"`)
  } else {
    inboundContent = `[${type}]`
    const mediaUrl = await persistInboundMedia(raw, type, tenantId, creds.metaToken)
    storedContent = mediaUrl ?? inboundContent
    storedType = ['image', 'video', 'document'].includes(type) ? type : 'text'
  }

  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    type: storedType,
    content: storedContent,
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
        if (alreadyConverted) {
          console.log(`[webhook] Keyword "${matched.keyword}" ignored because contact ${contact.id} is not reactivatable.`)
          return
        }

        keywordFlow = matched.flows as unknown as FlowInfo
        
        // Ejecutar flujo inicial SOLO si es una sesión inactiva/nueva
        // Si el estatus es 'human', NUNCA intervenimos.
        // Si la IA está apagada, la sesión NO está activa para el bot (dejamos que las keywords la revivan).
        const isExistingConversation = !isNewConversation

        if (isExistingConversation) {
          console.log(`[webhook] Keyword "${matched.keyword}" ignored because conversation already exists. AI will handle it if enabled.`)
        } else {
          // Vincular flujo nuevo a la conversación y reactivar la IA
          await supabase.from('conversations')
            .update({ flow_id: matched.flow_id, status: 'bot', ai_enabled: true })
            .eq('id', conversation.id)
          
          console.log(`[webhook] Keyword "${matched.keyword}" → executing flow "${(matched.flows as any)?.name}"`)
          await executeWelcomeFlow(matched.flow_id, from, conversation.id, tenantId, creds)
          return  // El flujo inicial ya respondió
        }
      }
    }
  }

  const existingFlow = conversation.flow_id
    ? await getFlowById(conversation.flow_id, tenantId)
    : null

  // Usar el flujo de la palabra clave nueva, o continuar con el flujo ya vinculado a la conversación.
  const activeFlow: FlowInfo | null = keywordFlow ?? existingFlow

  // Si es conversación nueva y NO hizo match con ninguna palabra clave, dejar en bandeja de entrada (open)
  if (isNewConversation && !activeFlow) {
    console.log(`[webhook] No keyword matched for new conversation. Routing to human inbox (open).`)
    await supabase.from('conversations')
      .update({ status: 'open', ai_enabled: false })
      .eq('id', conversation.id)
    return
  }

  // 6c. Reiniciar temporizadores de inactividad (con reglas del flujo)
  await resetInactivityTimers(conversation.id, from, activeFlow?.id, tenantId, creds)

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

  if (type === 'text' && activeFlow) {
    const handledChoice = await handleUnassignedPaymentChoice(
      activeFlow.id,
      tenantId,
      contact.id,
      from,
      conversation.id,
      inboundContent,
      creds,
    )
    if (handledChoice) return
  }

  // 7c. Procesar según tipo de mensaje
  let replyText: string

  if (type === 'image') {
    replyText = await handleImage(
      raw, contact.id, tenantId, conversation.id, from, creds,
      activeFlow?.system_prompt ?? undefined,
      (contact as any)?.name ?? null,
      activeFlow?.id,
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
      if (fn === 'call_attendant') {
        await supabase.from('conversations').update({ status: 'human' }).eq('id', conversation.id)
        await clearInactivityTimers(conversation.id)
        continue
      }

      if (fn === 'disqualified') {
        await Promise.all([
          supabase.from('contacts').update({ kanban_stage: 'disqualified' }).eq('id', contact.id),
          supabase.from('conversations').update({ status: 'disqualified', ai_enabled: false }).eq('id', conversation.id),
        ])
        await clearInactivityTimers(conversation.id)
        continue
      }

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
        await clearInactivityTimers(conversation.id)
        return // SILENCIO ABSOLUTO — el flujo de conversión ya respondió
      }
    }
  }

  // 7e. Detectar {{media:X}} en la respuesta y enviar multimedia
  if (activeFlow) {
    await maybeCreatePendingSale(
      activeFlow.id,
      tenantId,
      contact.id,
      conversation.id,
      `${inboundContent ?? ''}\n${cleaned || replyText}`,
    )
  }

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
        await saveOutbound(conversation.id, part.type, part.content)
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

  // 7f. (Eliminado: handoff automático por texto, ahora se usa {{function:call_attendant}})

  // 7g. Detectar descalificación → kanban disqualified + desactivar IA
  const disqualifyKeywords = [
    'no me interesa', 'no quiero', 'no gracias', 'déjame en paz',
    'no necesito', 'basta', 'para de escribir', 'no me escribas',
    'no me molestes', 'me molesta', 'me tiene harto', 'spameando',
    'no me interesa para nada', 'no compro',
    'reportar', 'voy a reportar',
  ]
  const inboundNorm = (inboundContent ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (disqualifyKeywords.some(kw => inboundNorm.includes(kw.normalize('NFD').replace(/[̀-ͯ]/g, '')))) {
    console.log(`[webhook] Contact ${contact.id} disqualified`)
    await Promise.all([
      supabase.from('contacts').update({ kanban_stage: 'disqualified' }).eq('id', contact.id),
      supabase.from('conversations').update({ status: 'disqualified', ai_enabled: false }).eq('id', conversation.id),
    ])
    await clearInactivityTimers(conversation.id)
    createNotification({ tenantId, type: 'disqualification', title: '❌ Contacto descalificado', body: `${from} no estaba interesado`, data: { phone: from } }).catch(() => {})
  }
}

async function persistInboundMedia(
  raw: Record<string, unknown>,
  type: string,
  tenantId: string,
  token?: string | null
): Promise<string | null> {
  if (!['image', 'video', 'document'].includes(type)) return null
  const payload = raw[type] as { id?: string; filename?: string; mime_type?: string } | undefined
  if (!payload?.id) return null

  try {
    const { buffer, mimeType } = await downloadMediaBuffer(payload.id, token)
    const ext = extensionFromMime(mimeType, payload.filename)
    const path = `${tenantId}/inbound/${Date.now()}-${payload.id}.${ext}`

    const { error } = await supabase.storage.from('media').upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    })
    if (error) throw error

    const { data } = supabase.storage.from('media').getPublicUrl(path)
    return data.publicUrl
  } catch (err) {
    console.error('[webhook] inbound media persist error:', err)
    return null
  }
}

function extensionFromMime(mimeType: string, filename?: string): string {
  const fileExt = filename?.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (fileExt) return fileExt
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('quicktime')) return 'mov'
  if (mimeType.includes('pdf')) return 'pdf'
  if (mimeType.includes('wordprocessingml')) return 'docx'
  return 'bin'
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
  flowId?: string,
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

  if (!validation.isVoucher) {
    return 'Fiera, esa imagen no parece un comprobante de pago. Mándame la captura del depósito o transferencia y lo verifico al tiro.'
  }

  if (!validation.valid) {
    return validation.message || 'No pude verificar ese comprobante. Mándame una captura más clara donde se vea monto y fecha.'
  }

  const activeFlow = flowId ? await getFlowById(flowId, tenantId) : await getActiveFlow(tenantId)
  const paymentConversions = activeFlow ? await getPaymentConversions(activeFlow.id) : []
  const matchedConversion = findConversionForAmount(paymentConversions, pendingSale?.amount ?? validation.amount)

  if (!activeFlow || !matchedConversion) {
    await saveUnassignedPayment(tenantId, contactId, conversationId, validation.amount)
    return buildUnassignedPaymentReply(validation.amount, paymentConversions)
  }

  const success = await executeConversionFlow(
    activeFlow.id,
    matchedConversion.function_name,
    contactId,
    contactPhone,
    conversationId,
    tenantId,
    creds,
  )

  if (success) {
    await clearInactivityTimers(conversationId)
    console.log(`[webhook] Payment conversion ${matchedConversion.function_name} triggered for contact ${contactId}`)
    return ''
  }

  return 'Pude leer el comprobante, pero no pude activar la entrega automática. Te paso con un asesor para resolverlo.'
}

// ─── Helpers de base de datos ─────────────────────────────────────────────────
type PaymentConversion = {
  function_name: string
  product_id: string | null
  products: { name: string; price: number } | null
}

async function getPaymentConversions(flowId: string): Promise<PaymentConversion[]> {
  const { data } = await supabase
    .from('flow_conversions')
    .select('function_name, product_id, products:product_id(name, price)')
    .eq('flow_id', flowId)

  return (data ?? []) as unknown as PaymentConversion[]
}

function findConversionForAmount(
  conversions: PaymentConversion[],
  amount: number | null | undefined
): PaymentConversion | null {
  if (!amount) return conversions.length === 1 ? conversions[0] : null

  const numericAmount = Number(amount)
  return conversions.find((conversion) => {
    const price = Number(conversion.products?.price ?? 0)
    return price > 0 && Math.abs(price - numericAmount) <= Math.max(1, price * 0.05)
  }) ?? null
}

async function saveUnassignedPayment(
  tenantId: string,
  contactId: string,
  conversationId: string,
  amount: number | null
) {
  if (!amount || amount <= 0) return

  const { data: existing } = await supabase
    .from('sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .eq('product', 'Pago sin asignar')
    .eq('amount', amount)
    .limit(1)
    .maybeSingle()

  if (existing?.id) return

  const { data: sale } = await supabase.from('sales').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    product: 'Pago sin asignar',
    amount,
    status: 'pending',
  }).select('id').single()

  if (sale?.id) {
    await propagateCampaignToSale(sale.id, conversationId)
  }
}

function buildUnassignedPaymentReply(
  amount: number | null,
  conversions: PaymentConversion[]
): string {
  const paid = Number(amount ?? 0)
  if (!paid) return 'Leí tu comprobante, pero no pude identificar el monto. Mándame una captura más clara donde se vea el total.'

  const products = conversions
    .map((conversion) => conversion.products)
    .filter((product): product is { name: string; price: number } => !!product && Number(product.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price))

  const covered = products.filter((product) => Number(product.price) <= paid)
  const upgrades = products.filter((product) => Number(product.price) > paid)

  if (covered.length || upgrades.length) {
    const coveredText = covered.length
      ? `Puedo activarte ${covered.map((p) => `${p.name} de Bs ${Number(p.price)}`).join(' o ')}.`
      : ''
    const upgradeText = upgrades.length
      ? `Si quieres ${upgrades[0].name}, completa Bs ${Number(upgrades[0].price) - paid}.`
      : ''

    return `Fiera, recibí tu pago de Bs ${paid}. ${coveredText} ${upgradeText} ¿Cuál opción quieres que active?`.replace(/\s+/g, ' ').trim()
  }

  return `Fiera, recibí tu pago de Bs ${paid}, pero no tengo un producto configurado para ese monto. ¿Qué producto quieres que te active?`
}

async function maybeCreatePendingSale(
  flowId: string,
  tenantId: string,
  contactId: string,
  conversationId: string,
  text: string,
) {
  if (!/\{\{\s*media:\s*qr\s*\}\}/i.test(text)) return

  const { data: existing } = await supabase
    .from('sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  if (existing?.id) return

  const conversions = await getPaymentConversions(flowId)
  const selected = inferConversionFromText(conversions, text)
  if (!selected?.products) return

  const { data: sale } = await supabase.from('sales').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    product: selected.products.name,
    amount: selected.products.price,
    status: 'pending',
  }).select('id').single()

  if (sale?.id) {
    await propagateCampaignToSale(sale.id, conversationId)
  }
}

function inferConversionFromText(
  conversions: PaymentConversion[],
  text: string
): PaymentConversion | null {
  if (conversions.length === 1) return conversions[0]

  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  return conversions.find((conversion) => {
    const product = conversion.products
    if (!product) return false

    const name = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const price = Number(product.price)

    return normalized.includes(name)
      || (name.includes('premium') && normalized.includes('premium'))
      || (name.includes('basico') && normalized.includes('basico'))
      || (price > 0 && new RegExp(`\\b${price}(?:\\.00)?\\b`).test(normalized))
  }) ?? null
}

async function handleUnassignedPaymentChoice(
  flowId: string,
  tenantId: string,
  contactId: string,
  contactPhone: string,
  conversationId: string,
  inboundText: string,
  creds?: { metaToken: string | null; phoneNumberId: string | null },
): Promise<boolean> {
  const { data: pendingPayment } = await supabase
    .from('sales')
    .select('id, amount')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .eq('product', 'Pago sin asignar')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!pendingPayment?.id) return false

  const conversions = await getPaymentConversions(flowId)
  const selected = inferConversionFromText(conversions, inboundText)
  if (!selected?.products) return false

  const paid = Number(pendingPayment.amount ?? 0)
  const price = Number(selected.products.price ?? 0)

  if (price > paid) {
    const diff = price - paid
    const msg = `De una, para ${selected.products.name} falta completar Bs ${diff}. Mándame el comprobante de la diferencia y te activo todo al tiro.`
    await sendTextMessage(contactPhone, msg, creds)
    await saveOutbound(conversationId, 'text', msg)
    return true
  }

  await supabase.from('sales').delete().eq('id', pendingPayment.id)

  const success = await executeConversionFlow(
    flowId,
    selected.function_name,
    contactId,
    contactPhone,
    conversationId,
    tenantId,
    creds,
  )

  if (success) {
    await clearInactivityTimers(conversationId)
    return true
  }

  const msg = 'Pude ubicar tu pago, pero no pude activar la entrega automática. Te paso con un asesor para resolverlo.'
  await sendTextMessage(contactPhone, msg, creds)
  await saveOutbound(conversationId, 'text', msg)
  return true
}

async function upsertContact(phone: string, tenantId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .upsert({ tenant_id: tenantId, phone }, { onConflict: 'tenant_id,phone' })
    .select('id, phone, kanban_stage')
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

async function getAutomationFlowByAdId(tenantId: string, metaAdId: string): Promise<{
  id: string
  name: string
  type: string
  model: string
  system_prompt: string | null
  automation_campaign_id: string
  executions: number
} | null> {
  const { data } = await supabase
    .from('automation_campaigns')
    .select('id, executions, flows(id, name, type, model, system_prompt)')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .eq('meta_ad_source_id', metaAdId)
    .not('flow_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const flow = Array.isArray((data as any)?.flows) ? (data as any).flows[0] : (data as any)?.flows
  if (!data || !flow?.id) return null

  return {
    id: flow.id,
    name: flow.name,
    type: flow.type,
    model: flow.model,
    system_prompt: flow.system_prompt,
    automation_campaign_id: (data as any).id,
    executions: (data as any).executions ?? 0,
  }
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
