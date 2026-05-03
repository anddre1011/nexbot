import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()

router.use(requireAuth)

// GET /api/campaigns
router.get('/', async (_req, res) => {
  const tenantId = res.locals.user.app_metadata?.tenant_id

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

// POST /api/campaigns
router.post('/', async (req, res) => {
  const tenantId = res.locals.user.app_metadata?.tenant_id
  const { name, meta_ad_id } = req.body

  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({ tenant_id: tenantId, name, meta_ad_id })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(data)
})

export default router
