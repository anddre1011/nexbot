import { Router } from 'express'
import { supabase } from '../services/supabase'
import { sendTextMessage, downloadMediaAsDataUrl } from '../services/whatsapp'
import { resetInactivityTimers, clearInactivityTimers } from '../services/inactivity'
import { resolveCampaign, linkConversationToCampaign, propagateCampaignToSale } from '../services/campaigns'
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
      .single()
    tenantId = data?.id
  }

  if (!tenantId) {
    tenantId = process.env.TENANT_ID
  }

  if (!tenantId) {
    console.error(`[webhook] No tenant found for phone_number_id="${phoneNumberId}" and TENANT_ID not set`)
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

  // 1. Upsert contacto
  const contact = await upsertContact(from, tenantId)

  // 2. Extraer campaña del referral de Meta (solo presente en primer mensaje del click)
  const { campaignId } = await resolveCampaign(raw, tenantId)

  // 3. Obtener o crear conversación abierta
  const conversation = await getOrCreateConversation(contact.id, tenantId)

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

  // 6b. Reiniciar temporizadores de inactividad
  resetInactivityTimers(conversation.id, from)

  // 7. Procesar según tipo
  let replyText: string

  if (type === 'image') {
    replyText = await handleImage(raw, contact.id, tenantId, conversation.id)
  } else {
    replyText = await handleText(inboundContent ?? '', conversation.id, tenantId)

    // Si el agente detecta handoff → marcar conversación como 'human'
    if (replyText.includes('asesor')) {
      await supabase
        .from('conversations')
        .update({ status: 'human' })
        .eq('id', conversation.id)
      clearInactivityTimers(conversation.id)
    }
  }

  // 7. Enviar respuesta al contacto
  await sendTextMessage(from, replyText)

  // 8. Guardar mensaje saliente
  await supabase.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'outbound',
    type: 'text',
    content: replyText,
  })
}

// ─── Manejo de mensajes de texto ─────────────────────────────────────────────
async function handleText(text: string, conversationId: string, tenantId: string): Promise<string> {
  const history = await getHistory(conversationId)
  const tenant  = await getTenant(tenantId)

  const result = await runAgent({
    contactPhone:    '',
    incomingMessage: text,
    history,
    tenantPrompt:    DEFAULT_SYSTEM_PROMPT,
    productName:     tenant?.name,
    productPrice:    undefined,
  })

  return result.reply
}

// ─── Manejo de imágenes (comprobantes) ───────────────────────────────────────
async function handleImage(
  raw: Record<string, unknown>,
  contactId: string,
  tenantId: string,
  conversationId: string
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

  if (validation.valid && pendingSale?.id) {
    // Confirmar venta y propagar campaign_id desde la conversación
    await supabase
      .from('sales')
      .update({ status: 'confirmed' })
      .eq('id', pendingSale.id)

    await propagateCampaignToSale(pendingSale.id, conversationId)

    // Cerrar conversación y cancelar timers
    await supabase
      .from('conversations')
      .update({ status: 'closed' })
      .eq('id', conversationId)

    clearInactivityTimers(conversationId)
    console.log(`[webhook] sale ${pendingSale.id} confirmed for contact ${contactId}`)
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
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .in('status', ['open', 'bot'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) return existing

  const { data, error } = await supabase
    .from('conversations')
    .insert({ tenant_id: tenantId, contact_id: contactId, status: 'bot' })
    .select('id, status')
    .single()

  if (error) throw new Error(`getOrCreateConversation: ${error.message}`)
  return data
}

async function getHistory(conversationId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(10)

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
    .select('name')
    .eq('id', tenantId)
    .single()
  return data
}

export default router
