import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()
router.use(requireAuth)

const VALID_TYPES = ['infoproduct', 'digital', 'physical', 'other'] as const

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants').select('id').eq('user_id', userId).eq('active', true).single()
  return data?.id ?? null
}

// ─── GET /api/products ────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('products')
    .select(`
      id, folder, name, type, price, description, delivery_url, active, created_at,
      upsell:upsell_id(id, name),
      downsell:downsell_id(id, name)
    `)
    .eq('tenant_id', tenantId)
    .order('folder')
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/products ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, type, price, description, delivery_url, folder, upsell_id, downsell_id } = req.body

  if (!name?.trim())          { res.status(400).json({ error: 'name is required' }); return }
  if (price == null)          { res.status(400).json({ error: 'price is required' }); return }
  if (!VALID_TYPES.includes(type)) { res.status(400).json({ error: 'invalid type' }); return }

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id:    tenantId,
      name:         name.trim(),
      type,
      price:        Number(price),
      description:  description?.trim() ?? null,
      delivery_url: delivery_url?.trim() ?? null,
      folder:       folder?.trim() || 'General',
      upsell_id:    upsell_id   ?? null,
      downsell_id:  downsell_id ?? null,
    })
    .select('id, folder, name, type, price, description, delivery_url, active, created_at')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/products/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'type', 'price', 'description', 'delivery_url', 'folder', 'upsell_id', 'downsell_id', 'active'] as const
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }
  if (updates.price !== undefined) updates.price = Number(updates.price)
  if (!Object.keys(updates).length) { res.status(400).json({ error: 'No fields to update' }); return }

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, folder, name, type, price, description, delivery_url, active, upsell_id, downsell_id')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/products/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('products').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

export default router
