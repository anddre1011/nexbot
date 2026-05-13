import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { sendTextMessage, sendAudioMessage } from '../services/whatsapp'
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

// ─── GET /api/conversations ───────────────────────────────────────────────────
// ?view=kanban → usa get_kanban_conversations con soporte de ?date_from=ISO
router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  if (req.query.view === 'kanban') {
    const dateFrom = req.query.date_from as string | undefined
    const { data, error } = await supabase.rpc('get_kanban_conversations', {
      p_tenant_id: tenantId,
      p_date_from: dateFrom ?? null,
    })
    if (error) { res.status(500).json({ error: error.message }); return }
    return res.json(data)
  }

  const { data, error } = await supabase.rpc('get_conversation_list', {
    p_tenant_id: tenantId,
  })
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
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
    .insert({ conversation_id: req.params.id, direction: 'outbound', type: 'audio', content: '[audio]' })
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

  const { data, error } = await supabase
    .from('conversations')
    .update({ status })
    .eq('id', req.params.id)
    .select('id, status')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
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
