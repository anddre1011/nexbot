import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { ensureTenantForUser } from '../services/tenants'

const router = Router()
router.use(requireAuth)

const VALID_TYPES = ['infoproduct', 'digital', 'physical', 'other'] as const

// ─── GET /api/products ────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const tenantId = await ensureTenantForUser(res.locals.user)

  const { data, error } = await supabase
    .from('products')
    .select('id, folder, name, type, price, currency, banner_url, description, delivery_url, active, created_at, upsell_id, downsell_id')
    .eq('tenant_id', tenantId)
    .order('folder')
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }

  // Resolver nombres de upsell/downsell manualmente
  const products = (data ?? []).map((p: any) => ({
    ...p,
    upsell:   p.upsell_id   ? data?.find((x: any) => x.id === p.upsell_id)   ? { id: p.upsell_id,   name: data.find((x: any) => x.id === p.upsell_id)?.name }   : null : null,
    downsell: p.downsell_id ? data?.find((x: any) => x.id === p.downsell_id) ? { id: p.downsell_id, name: data.find((x: any) => x.id === p.downsell_id)?.name } : null : null,
  }))

  res.json(products)
})

// ─── POST /api/products ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenantId = await ensureTenantForUser(res.locals.user)

  const { name, type, price, currency, banner_url, description, delivery_url, folder, upsell_id, downsell_id } = req.body

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
      currency:     currency ?? 'BOB',
      banner_url:   banner_url?.trim() ?? null,
      description:  description?.trim() ?? null,
      delivery_url: delivery_url?.trim() ?? null,
      folder:       folder?.trim() || 'General',
      upsell_id:    upsell_id   ?? null,
      downsell_id:  downsell_id ?? null,
    })
    .select('id, folder, name, type, price, currency, banner_url, description, delivery_url, active, created_at')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/products/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'type', 'price', 'currency', 'banner_url', 'description', 'delivery_url', 'folder', 'upsell_id', 'downsell_id', 'active'] as const
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
    .select('id, folder, name, type, price, currency, banner_url, description, delivery_url, active, upsell_id, downsell_id')
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
