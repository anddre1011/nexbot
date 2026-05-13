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

// GET /api/sales
router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  let query = supabase
    .from('sales')
    .select('*, contacts(name, phone), campaigns(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const { from, to, product, campaign_id, status } = req.query
  if (from) query = query.gte('created_at', String(from))
  if (to) query = query.lte('created_at', String(to))
  if (product) query = query.eq('product', String(product))
  if (campaign_id) query = query.eq('campaign_id', String(campaign_id))
  if (status) query = query.eq('status', String(status))

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

// PATCH /api/sales/:id — actualizar estado de una venta
router.patch('/:id', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { status } = req.body
  const allowed = ['pending', 'confirmed', 'rejected']

  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }

  const { data, error } = await supabase
    .from('sales')
    .update({ status })
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

export default router
