import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()
router.use(requireAuth)

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase.from('tenants').select('id').eq('user_id', userId).eq('active', true).single()
  return data?.id ?? null
}

router.get('/', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }
  const { data, error } = await supabase.from('media').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

router.post('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }
  const { name, type, url, size_bytes, folder, variable } = req.body
  if (!name || !type || !url) { res.status(400).json({ error: 'name, type, url required' }); return }
  const { data, error } = await supabase.from('media')
    .insert({ tenant_id: tenantId, name, type, url, size_bytes: size_bytes ?? null, folder: folder ?? 'General', variable: variable ?? null })
    .select().single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('media').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

export default router
