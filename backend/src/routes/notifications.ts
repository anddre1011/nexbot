import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()
router.use(requireAuth)

async function getTenantId(userId: string) {
  const { data } = await supabase.from('tenants').select('id').eq('user_id', userId).eq('active', true).single()
  return data?.id ?? null
}

// GET /api/notifications — últimas 50 notificaciones
router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) return res.status(404).json({ error: 'Tenant not found' })

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PATCH /api/notifications/read-all — marcar todas como leídas
router.patch('/read-all', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) return res.status(404).json({ error: 'Tenant not found' })

  await supabase.from('notifications').update({ read: true }).eq('tenant_id', tenantId).eq('read', false)
  res.json({ ok: true })
})

// PATCH /api/notifications/:id/read — marcar una como leída
router.patch('/:id/read', async (req, res) => {
  await supabase.from('notifications').update({ read: true }).eq('id', req.params.id)
  res.json({ ok: true })
})

// GET /api/notifications/preferences
router.get('/preferences', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) return res.status(404).json({ error: 'Tenant not found' })

  const { data } = await supabase.from('notification_preferences').select('*').eq('tenant_id', tenantId).maybeSingle()
  res.json(data ?? { sales: true, disqualifications: true, low_credits: true, new_contacts: false, push_enabled: false })
})

// PUT /api/notifications/preferences
router.put('/preferences', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) return res.status(404).json({ error: 'Tenant not found' })

  const { sales, disqualifications, low_credits, new_contacts, push_enabled } = req.body
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ tenant_id: tenantId, sales, disqualifications, low_credits, new_contacts, push_enabled, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// POST /api/notifications/push-subscribe — guardar suscripción push del navegador
router.post('/push-subscribe', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) return res.status(404).json({ error: 'Tenant not found' })

  const { subscription, userAgent } = req.body
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' })

  await supabase.from('push_subscriptions').upsert(
    { tenant_id: tenantId, endpoint: subscription.endpoint, subscription, user_agent: userAgent },
    { onConflict: 'tenant_id,endpoint' }
  )
  res.json({ ok: true })
})

// GET /api/notifications/vapid-public-key
router.get('/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null })
})

export default router
