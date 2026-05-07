import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { sendTextMessage } from '../services/whatsapp'

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

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
router.get('/:id/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, type, content, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/conversations/:id/messages — envío manual ─────────────────────
router.post('/:id/messages', async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) { res.status(400).json({ error: 'content required' }); return }

  // Obtener teléfono del contacto desde la conversación
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('contact_id, contacts(phone)')
    .eq('id', req.params.id)
    .single()

  if (convErr || !conv) { res.status(404).json({ error: 'Conversation not found' }); return }

  const phone = (conv.contacts as unknown as { phone: string } | null)?.phone
  if (!phone) { res.status(400).json({ error: 'Contact phone not found' }); return }

  // Enviar por WhatsApp y guardar en BD en paralelo
  const [, { data: msg, error: msgErr }] = await Promise.all([
    sendTextMessage(phone, content.trim()),
    supabase
      .from('messages')
      .insert({
        conversation_id: req.params.id,
        direction: 'outbound',
        type: 'text',
        content: content.trim(),
      })
      .select('id, direction, type, content, created_at')
      .single(),
  ])

  if (msgErr) { res.status(500).json({ error: msgErr.message }); return }
  res.status(201).json(msg)
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
  // 2. Resetear conversación: bot activo, IA habilitada, sin campaña
  const { error } = await supabase
    .from('conversations')
    .update({ status: 'bot', last_read_at: null })
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

export default router
