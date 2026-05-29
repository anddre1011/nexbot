import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

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

async function deleteInChunks(table: string, column: string, ids: string[]) {
  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from(table)
      .delete()
      .in(column, chunk)
      .select('id')
    if (error) throw error
    deleted += data?.length ?? chunk.length
  }
  return deleted
}

// ─── GET /api/contacts ────────────────────────────────────────────────────────
// ?status=active|blocked|unsubscribed
// ?campaign_id=uuid
// ?kanban=human|attending|converted|...
// ?search=texto
router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { status, campaign_id, kanban, search } = req.query

  // Intentar RPC enriquecida, fallback a query simple si falla
  let { data, error } = await supabase.rpc('get_contacts_list', {
    p_tenant_id:   tenantId,
    p_status:      (status      as string) ?? null,
    p_campaign_id: (campaign_id as string) ?? null,
    p_kanban:      (kanban      as string) ?? null,
    p_search:      (search      as string) ?? null,
  })

  if (error) {
    // Fallback: query directa sin RPC
    const q = supabase.from('contacts').select('*').eq('tenant_id', tenantId).order('last_message_at', { ascending: false })
    if (search) q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
    const { data: fallback, error: e2 } = await q
    if (e2) { res.status(500).json({ error: e2.message }); return }
    data = fallback
    error = null
  }

  if (error) { res.status(500).json({ error: (error as any)?.message ?? 'Error' }); return }
  res.json(data)
})

// POST /api/contacts/cleanup
// Borra chats y contactos no compradores. Conserva los contactos con ventas confirmadas.
router.post('/cleanup', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  if (req.body?.confirm !== 'ELIMINAR') {
    res.status(400).json({ error: 'Confirmacion requerida' })
    return
  }

  try {
    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select('contact_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')

    if (salesErr) throw salesErr

    const buyerIds = new Set((sales ?? []).map((s: any) => s.contact_id).filter(Boolean))

    const { data: contacts, error: contactsErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)

    if (contactsErr) throw contactsErr

    const allContactIds = (contacts ?? []).map((c: any) => c.id)
    const nonBuyerIds = allContactIds.filter((id: string) => !buyerIds.has(id))
    const buyerContactIds = allContactIds.filter((id: string) => buyerIds.has(id))

    let buyerConversationsDeleted = 0
    if (buyerContactIds.length) {
      buyerConversationsDeleted = await deleteInChunks('conversations', 'contact_id', buyerContactIds)
    }

    let nonBuyerContactsDeleted = 0
    if (nonBuyerIds.length) {
      nonBuyerContactsDeleted = await deleteInChunks('contacts', 'id', nonBuyerIds)
    }

    res.json({
      ok: true,
      buyers_kept: buyerContactIds.length,
      buyer_chats_deleted: buyerConversationsDeleted,
      contacts_deleted: nonBuyerContactsDeleted,
    })
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Cleanup failed' })
  }
})

// ─── GET /api/contacts/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) { res.status(404).json({ error: 'Contact not found' }); return }
  res.json(data)
})

// ─── POST /api/contacts ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, phone, tags } = req.body
  if (!phone?.trim()) { res.status(400).json({ error: 'phone is required' }); return }

  const { data, error } = await supabase
    .from('contacts')
    .insert({ tenant_id: tenantId, phone: phone.trim(), name: name?.trim() ?? null, tags: tags ?? [] })
    .select('id, phone, name, status, ai_enabled, tags, created_at')
    .single()

  if (error) {
    const msg = error.code === '23505' ? 'Este número ya existe' : error.message
    res.status(400).json({ error: msg }); return
  }
  res.status(201).json(data)
})

// ─── PATCH /api/contacts/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'status', 'ai_enabled', 'tags'] as const
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  if (!Object.keys(updates).length) {
    res.status(400).json({ error: 'No valid fields to update' }); return
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, phone, name, status, ai_enabled, tags')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/contacts/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

export default router
