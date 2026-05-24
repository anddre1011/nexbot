import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { sendTextMessage, sendAudioMessage, sendMediaByType } from '../services/whatsapp'
import { executeWelcomeFlow } from '../services/flow-engine'

const router = Router()

router.use(requireAuth)

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .single()
  return data?.id ?? null
}

function previewMessage(message: any) {
  if (!message) return null
  if (message.type === 'image') return 'Imagen'
  if (message.type === 'video') return 'Video'
  if (message.type === 'audio') return 'Audio'
  if (message.type === 'document' || message.type === 'file') return 'Archivo'
  return message.content ?? null
}

function previewStoredContent(content: string | null) {
  if (!content) return null
  if (/^https?:\/\//i.test(content)) {
    if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(content)) return 'Imagen'
    if (/\.(mp4|mov|webm)(\?|$)/i.test(content)) return 'Video'
    if (/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(content)) return 'Audio'
    return 'Archivo'
  }
  return content
}

async function fetchLatestSaleByContact(tenantId: string, contactIds: string[]) {
  const { data: sales } = contactIds.length
    ? await supabase
        .from('sales')
        .select('contact_id, amount, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'confirmed')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false })
    : { data: [] as any[] }

  const latestSaleByContact = new Map<string, number>()
  for (const sale of sales ?? []) {
    if (!latestSaleByContact.has(sale.contact_id)) latestSaleByContact.set(sale.contact_id, Number(sale.amount))
  }
  return latestSaleByContact
}

async function fetchLatestMessagesByConversation(conversationIds: string[]) {
  const limit = Math.min(Math.max(conversationIds.length * 20, 1000), 5000)
  const { data, error } = conversationIds.length
    ? await supabase
        .from('messages')
        .select('conversation_id, direction, content, type, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(limit)
    : { data: [] as any[], error: null }

  const messages = data ?? []
  const lastByConversation = new Map<string, any>()

  if (!error) {
    for (const message of messages) {
      if (!lastByConversation.has(message.conversation_id)) {
        lastByConversation.set(message.conversation_id, message)
      }
    }
  } else {
    console.error('[conversations] latest messages batch error:', error.message)
  }

  const shouldFallback = !!error || messages.length >= limit
  const missingIds = shouldFallback
    ? conversationIds.filter((id) => !lastByConversation.has(id)).slice(0, 200)
    : []
  if (missingIds.length) {
    const fallback = await Promise.all(
      missingIds.map((id) =>
        supabase
          .from('messages')
          .select('conversation_id, direction, content, type, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    )

    for (const result of fallback) {
      if (result.error) {
        console.error('[conversations] latest message fallback error:', result.error.message)
        continue
      }
      if (result.data) lastByConversation.set(result.data.conversation_id, result.data)
    }
  }

  return { messages, lastByConversation }
}

// ─── GET /api/conversations ───────────────────────────────────────────────────
// ?view=kanban → usa get_kanban_conversations con soporte de ?date_from=ISO
router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  if (req.query.view === 'kanban') {
    const dateFrom = req.query.date_from as string | undefined
    let query = supabase
      .from('conversations')
      .select('id, status, contact_id, campaign_id, created_at, contacts!inner(id, phone, name, kanban_stage, last_message_at), campaigns(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (dateFrom) query = query.gte('created_at', dateFrom)

    const { data, error } = await query
    if (error) { res.status(500).json({ error: error.message }); return }

    const contactIds = [...new Set((data ?? []).map((row: any) => row.contact_id).filter(Boolean))]
    const { data: sales } = contactIds.length
      ? await supabase
          .from('sales')
          .select('contact_id, amount, created_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'confirmed')
          .in('contact_id', contactIds)
          .order('created_at', { ascending: false })
      : { data: [] as any[] }

    const latestSaleByContact = new Map<string, number>()
    for (const sale of sales ?? []) {
      if (!latestSaleByContact.has(sale.contact_id)) latestSaleByContact.set(sale.contact_id, Number(sale.amount))
    }

    const kanbanStatuses = new Set(['human', 'attending', 'converted', 'disqualified', 'abandoned'])
    const rows = (data ?? []).map((row: any) => {
      const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
      const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns
      const stage = contact?.kanban_stage && kanbanStatuses.has(contact.kanban_stage)
        ? contact.kanban_stage
        : row.status
      return {
        id: row.id,
        status: stage,
        contact_id: row.contact_id,
        contact_phone: contact?.phone ?? '',
        contact_name: contact?.name ?? null,
        campaign_name: campaign?.name ?? null,
        campaign_id: row.campaign_id,
        last_message_at: contact?.last_message_at ?? null,
        sale_amount: latestSaleByContact.get(row.contact_id) ?? null,
        created_at: row.created_at,
      }
    }).filter((row) => kanbanStatuses.has(row.status))

    return res.json(rows)
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('get_conversation_list', { p_tenant_id: tenantId })
  if (!rpcError && Array.isArray(rpcRows)) {
    const contactIds = [...new Set(rpcRows.map((row: any) => row.contact_id).filter(Boolean))]
    const latestSaleByContact = await fetchLatestSaleByContact(tenantId, contactIds)
    return res.json(rpcRows.map((row: any) => ({
      id: row.id,
      status: row.status,
      campaign_id: row.campaign_id,
      created_at: row.created_at,
      contact_id: row.contact_id,
      contact_phone: row.contact_phone ?? '',
      contact_name: row.contact_name ?? null,
      last_message: previewStoredContent(row.last_message),
      last_direction: row.last_direction ?? null,
      last_message_at: row.last_message_at ?? row.created_at,
      unread_count: Number(row.unread_count ?? 0),
      has_confirmed_sale: latestSaleByContact.has(row.contact_id),
      sale_amount: latestSaleByContact.get(row.contact_id) ?? null,
    })))
  }
  if (rpcError) console.error('[conversations] get_conversation_list fallback:', rpcError.message)

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, status, campaign_id, created_at, last_read_at, contact_id, contacts!inner(id, phone, name), campaigns(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }

  const conversationIds = (conversations ?? []).map((row: any) => row.id)
  const contactIds = [...new Set((conversations ?? []).map((row: any) => row.contact_id).filter(Boolean))]
  const { messages, lastByConversation } = await fetchLatestMessagesByConversation(conversationIds)
  const unreadByConversation = new Map<string, number>()
  const latestSaleByContact = await fetchLatestSaleByContact(tenantId, contactIds)

  for (const row of conversations ?? []) {
    const lastReadAt = row.last_read_at ? new Date(row.last_read_at).getTime() : 0
    const unread = messages.filter((message: any) =>
      message.conversation_id === row.id &&
      message.direction === 'inbound' &&
      new Date(message.created_at).getTime() > lastReadAt
    ).length
    unreadByConversation.set(row.id, unread)
  }

  const rows = (conversations ?? []).map((row: any) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    const last = lastByConversation.get(row.id)
    return {
      id: row.id,
      status: row.status,
      campaign_id: row.campaign_id,
      created_at: row.created_at,
      contact_id: row.contact_id,
      contact_phone: contact?.phone ?? '',
      contact_name: contact?.name ?? null,
      last_message: previewMessage(last),
      last_direction: last?.direction ?? null,
      last_message_at: last?.created_at ?? row.created_at,
      unread_count: unreadByConversation.get(row.id) ?? 0,
      has_confirmed_sale: latestSaleByContact.has(row.contact_id),
      sale_amount: latestSaleByContact.get(row.contact_id) ?? null,
    }
  }).sort((a, b) =>
    new Date(b.last_message_at ?? b.created_at).getTime() -
    new Date(a.last_message_at ?? a.created_at).getTime()
  )

  res.json(rows)
})

router.delete('/:id/test-reset', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', conv.contact_id)
    .eq('tenant_id', tenantId)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
router.delete('/:id/reset', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  await supabase.from('messages').delete().eq('conversation_id', req.params.id)

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'open', ai_enabled: true, flow_id: null, flow_step: 0, last_read_at: new Date().toISOString() })
    .eq('id', req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }

  await supabase
    .from('contacts')
    .update({ kanban_stage: 'open' })
    .eq('id', conv.contact_id)
    .eq('tenant_id', tenantId)

  res.json({ ok: true })
})

router.get('/:id/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, type, content, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/conversations/:id/messages — envío manual (activa human takeover) ──
router.post('/:id/messages', async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return }

  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  // Obtener teléfono + credenciales Meta del tenant
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('contact_id, contacts(phone)')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (convErr || !conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  const phone = (conv.contacts as unknown as { phone: string } | null)?.phone
  if (!phone) { res.status(400).json({ error: 'Contact phone not found' }); return }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('meta_token, phone_number_id')
    .eq('id', tenantId)
    .single()

  const creds = { metaToken: (tenant as any)?.meta_token, phoneNumberId: (tenant as any)?.phone_number_id }

  // Enviar por WhatsApp, guardar mensaje y activar human takeover en paralelo
  const [, { data: msg, error: msgErr }] = await Promise.all([
    sendTextMessage(phone, content.trim(), creds),
    supabase
      .from('messages')
      .insert({ conversation_id: req.params.id, direction: 'outbound', type: 'text', content: content.trim() })
      .select('id, direction, type, content, created_at')
      .single(),
  ])

  if (msgErr) { res.status(500).json({ error: msgErr.message }); return }

  // Human takeover: desactivar IA y marcar como atendido por humano
  await supabase
    .from('conversations')
    .update({ status: 'human', ai_enabled: false })
    .eq('id', req.params.id)

  res.status(201).json({ ...msg, status: 'human' })
})

// ─── POST /api/conversations/:id/send-audio — enviar audio grabado ────────────
router.post('/:id/send-audio', async (req, res) => {
  const { audio_url } = req.body
  if (!audio_url) { res.status(400).json({ error: 'audio_url required' }); return }

  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id, contacts(phone)')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }
  const phone = (conv.contacts as unknown as { phone: string } | null)?.phone
  if (!phone) { res.status(400).json({ error: 'Contact phone not found' }); return }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('meta_token, phone_number_id')
    .eq('id', tenantId)
    .single()

  const creds = { metaToken: (tenant as any)?.meta_token, phoneNumberId: (tenant as any)?.phone_number_id }

  await sendAudioMessage(phone, audio_url, creds)

  const { data: msg } = await supabase
    .from('messages')
    .insert({ conversation_id: req.params.id, direction: 'outbound', type: 'audio', content: audio_url })
    .select('id, direction, type, content, created_at')
    .single()

  // Human takeover al enviar audio manual también
  await supabase
    .from('conversations')
    .update({ status: 'human', ai_enabled: false })
    .eq('id', req.params.id)

  res.status(201).json({ ...msg, status: 'human' })
})

// ─── POST /api/conversations/:id/trigger-flow — lanzar flujo manualmente ─────
router.post('/:id/send-media', async (req, res) => {
  try {
    const { media_url, type, caption, filename } = req.body
    const mediaType = type === 'file' ? 'document' : type
    if (!media_url || !['image', 'video', 'audio', 'document'].includes(mediaType)) {
      res.status(400).json({ error: 'media_url and valid type required' })
      return
    }

    const tenantId = await getTenantId(res.locals.user.id)
    if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

    const { data: conv } = await supabase
      .from('conversations')
      .select('contact_id, contacts(phone)')
      .eq('tenant_id', tenantId)
      .eq('id', req.params.id)
      .single()

    if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }
    const phone = Array.isArray((conv as any).contacts)
      ? (conv as any).contacts[0]?.phone
      : (conv as any).contacts?.phone
    if (!phone) { res.status(400).json({ error: 'Contact phone not found' }); return }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('meta_token, phone_number_id')
      .eq('id', tenantId)
      .single()

    const creds = { metaToken: (tenant as any)?.meta_token, phoneNumberId: (tenant as any)?.phone_number_id }
    const sendCaption = mediaType === 'document' ? (filename || caption || 'archivo') : caption
    await sendMediaByType(phone, mediaType, media_url, sendCaption, creds)

    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({ conversation_id: req.params.id, direction: 'outbound', type: mediaType, content: media_url })
      .select('id, direction, type, content, created_at')
      .single()

    if (msgErr) { res.status(500).json({ error: msgErr.message }); return }

    await supabase
      .from('conversations')
      .update({ status: 'human', ai_enabled: false })
      .eq('id', req.params.id)

    res.status(201).json({ ...msg, status: 'human' })
  } catch (err: any) {
    const metaError = err?.response?.data?.error?.message || err?.response?.data?.error
    const message = metaError || err?.message || 'Error al enviar archivo'
    console.error('[conversations/send-media]', message)
    res.status(500).json({ error: message })
  }
})

router.post('/:id/trigger-flow', async (req, res) => {
  const { flow_id } = req.body
  if (!flow_id) { res.status(400).json({ error: 'flow_id required' }); return }

  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id, contacts(phone)')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }
  const phone = (conv.contacts as unknown as { phone: string } | null)?.phone
  if (!phone) { res.status(400).json({ error: 'Contact phone not found' }); return }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('meta_token, phone_number_id')
    .eq('id', tenantId)
    .single()

  const creds = { metaToken: (tenant as any)?.meta_token, phoneNumberId: (tenant as any)?.phone_number_id }

  // Vincular flujo a la conversación y ejecutar steps de bienvenida
  await supabase
    .from('conversations')
    .update({ flow_id, flow_step: 0, ai_enabled: true, status: 'bot' })
    .eq('id', req.params.id)

  await supabase
    .from('contacts')
    .update({ kanban_stage: 'open' })
    .eq('id', conv.contact_id)
    .eq('tenant_id', tenantId)

  await executeWelcomeFlow(flow_id, phone, req.params.id, tenantId, creds)

  res.json({ ok: true })
})

// ─── PATCH /api/conversations/:id/status — mover en Kanban ───────────────────
const VALID_STATUSES = ['open', 'closed', 'bot', 'human', 'attending', 'converted', 'disqualified', 'abandoned']

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` })
    return
  }

  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const updates: Record<string, unknown> = { status }
  if (status === 'bot' || status === 'open') updates.ai_enabled = true
  if (['human', 'closed', 'attending', 'converted', 'disqualified', 'abandoned'].includes(status)) updates.ai_enabled = false

  const { data, error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .select('id, status')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }

  if (['open', 'human', 'attending', 'converted', 'disqualified', 'abandoned'].includes(status)) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('contact_id')
      .eq('id', req.params.id)
      .eq('tenant_id', tenantId)
      .single()

    if (conv?.contact_id) {
      await supabase
        .from('contacts')
        .update({ kanban_stage: status })
        .eq('id', conv.contact_id)
        .eq('tenant_id', tenantId)
    }
  }

  res.json(data)
})

// ─── DELETE /api/conversations/:id/reset — reiniciar para pruebas ────────────
router.delete('/:id/reset', async (req, res) => {
  // 1. Borrar todos los mensajes
  await supabase.from('messages').delete().eq('conversation_id', req.params.id)
  
  // 2. Borrar la conversación entera para que actúe como un cliente 100% nuevo
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', req.params.id)
    
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ─── PATCH /api/conversations/:id/read — marcar como leído ───────────────────
router.patch('/:id/read', async (req, res) => {
  const { error } = await supabase
    .from('conversations')
    .update({ last_read_at: new Date().toISOString() })
    .eq('id', req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

router.delete('/:id/reset-soft', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .single()

  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  await supabase.from('messages').delete().eq('conversation_id', req.params.id)

  const { error } = await supabase
    .from('conversations')
    .update({ status: 'open', ai_enabled: true, flow_id: null, flow_step: 0, last_read_at: new Date().toISOString() })
    .eq('id', req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }

  await supabase
    .from('contacts')
    .update({ kanban_stage: 'open' })
    .eq('id', conv.contact_id)
    .eq('tenant_id', tenantId)

  res.json({ ok: true })
})

export default router
