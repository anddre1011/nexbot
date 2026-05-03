import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()

router.use(requireAuth)

// GET /api/sales
router.get('/', async (_req, res) => {
  const tenantId = res.locals.user.app_metadata?.tenant_id

  const { data, error } = await supabase
    .from('sales')
    .select('*, contacts(name, phone), campaigns(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

// PATCH /api/sales/:id — actualizar estado de una venta
router.patch('/:id', async (req, res) => {
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
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

export default router
