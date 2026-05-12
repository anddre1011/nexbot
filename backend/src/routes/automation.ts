import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()
router.use(requireAuth)

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants').select('id').eq('user_id', userId).eq('active', true).single()
  return data?.id ?? null
}

// ════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════
router.get('/campaigns', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('automation_campaigns')
    .select('id, name, flow_id, product_id, meta_ad_source_id, source_ids, executions, active, created_at, flows(id, name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.post('/campaigns', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, flow_id, product_id, meta_ad_source_id, source_ids } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return }

  const { data, error } = await supabase
    .from('automation_campaigns')
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      flow_id: flow_id ?? null,
      product_id: product_id ?? null,
      meta_ad_source_id: meta_ad_source_id?.trim() ?? null,
      source_ids: source_ids ?? [],
    })
    .select('id, name, meta_ad_source_id, source_ids, executions, active, created_at')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

router.patch('/campaigns/:id', async (req, res) => {
  const { active, name, flow_id, product_id, meta_ad_source_id, source_ids } = req.body
  const updates: Record<string, unknown> = {}
  if (active          !== undefined) updates.active            = active
  if (name            !== undefined) updates.name              = name
  if (flow_id         !== undefined) updates.flow_id           = flow_id
  if (product_id      !== undefined) updates.product_id        = product_id
  if (meta_ad_source_id !== undefined) updates.meta_ad_source_id = meta_ad_source_id
  if (source_ids      !== undefined) updates.source_ids        = source_ids

  const { data, error } = await supabase
    .from('automation_campaigns').update(updates).eq('id', req.params.id)
    .select('id, name, active, flow_id, product_id, meta_ad_source_id, source_ids').single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.delete('/campaigns/:id', async (req, res) => {
  const { error } = await supabase.from('automation_campaigns').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════
// KEYWORDS
// ════════════════════════════════════════════════════════════
router.get('/keywords', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('keywords')
    .select('id, keyword, executions, active, created_at, flows(id, name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.post('/keywords', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { keyword, flow_id } = req.body
  if (!keyword?.trim()) { res.status(400).json({ error: 'keyword is required' }); return }

  const { data, error } = await supabase
    .from('keywords')
    .insert({ tenant_id: tenantId, keyword: keyword.trim().toLowerCase(), flow_id: flow_id ?? null })
    .select('id, keyword, executions, active, created_at')
    .single()

  if (error) {
    const msg = error.code === '23505' ? 'Esa palabra clave ya existe' : error.message
    res.status(400).json({ error: msg }); return
  }
  res.status(201).json(data)
})

router.patch('/keywords/:id', async (req, res) => {
  const { active } = req.body
  const { data, error } = await supabase
    .from('keywords').update({ active }).eq('id', req.params.id)
    .select('id, keyword, active').single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.delete('/keywords/:id', async (req, res) => {
  const { error } = await supabase.from('keywords').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════
// SEQUENCES
// ════════════════════════════════════════════════════════════
router.get('/sequences', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('sequences')
    .select('id, name, messages, executions, active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.post('/sequences', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, messages } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return }

  const { data, error } = await supabase
    .from('sequences')
    .insert({ tenant_id: tenantId, name: name.trim(), messages: messages ?? [] })
    .select('id, name, messages, executions, active, created_at')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

router.patch('/sequences/:id', async (req, res) => {
  const allowed = ['name', 'messages', 'active'] as const
  const updates: Record<string, unknown> = {}
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k]

  const { data, error } = await supabase
    .from('sequences').update(updates).eq('id', req.params.id)
    .select('id, name, active').single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.delete('/sequences/:id', async (req, res) => {
  const { error } = await supabase.from('sequences').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

export default router
