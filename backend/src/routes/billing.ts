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

// ─── GET /api/billing/plans ───────────────────────────────────────────────────
router.get('/plans', async (_req, res) => {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('price_bob')

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── GET /api/billing/subscription ───────────────────────────────────────────
router.get('/subscription', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.json(null); return }

  const { data } = await supabase
    .from('subscriptions')
    .select('id, status, started_at, expires_at, plans(*)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .single()

  res.json(data ?? null)
})

// ─── GET /api/billing/payments ────────────────────────────────────────────────
router.get('/payments', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.json([]); return }

  const { data, error } = await supabase
    .from('payments')
    .select('id, amount_bob, method, reference, status, notes, created_at, plans(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/billing/activate ──────────────────────────────────────────────
// Activa un plan manualmente después de recibir el pago (QR / transferencia)
router.post('/activate', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { plan_id, method, reference, notes } = req.body
  if (!plan_id) { res.status(400).json({ error: 'plan_id is required' }); return }

  // Verificar que el plan existe y obtener su precio
  const { data: plan, error: planErr } = await supabase
    .from('plans').select('id, price_bob').eq('id', plan_id).single()
  if (planErr || !plan) { res.status(404).json({ error: 'Plan not found' }); return }

  // Expirar suscripción activa anterior
  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  const now      = new Date()
  const expiresAt = new Date(now)
  expiresAt.setMonth(expiresAt.getMonth() + 1)

  // Crear nueva suscripción
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .insert({
      tenant_id:  tenantId,
      plan_id:    plan.id,
      status:     'active',
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()

  if (subErr) { res.status(500).json({ error: subErr.message }); return }

  // Registrar pago
  const { error: payErr } = await supabase
    .from('payments')
    .insert({
      tenant_id:       tenantId,
      subscription_id: sub.id,
      plan_id:         plan.id,
      amount_bob:      plan.price_bob,
      method:          method ?? 'manual',
      reference:       reference ?? null,
      notes:           notes    ?? null,
      status:          'confirmed',
    })

  if (payErr) { res.status(500).json({ error: payErr.message }); return }

  res.status(201).json({
    ok:         true,
    expires_at: expiresAt.toISOString(),
  })
})

// ─── POST /api/billing/cancel ─────────────────────────────────────────────────
router.post('/cancel', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  res.json({ ok: true })
})

export default router
