import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()

router.use(requireAuth)

// ─── Helper: tenant del usuario autenticado ───────────────────────────────────
async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(1)
    .single()
  return data?.id ?? null
}

function todayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ─── GET /api/analytics/today ─────────────────────────────────────────────────
router.get('/today', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const [salesRes, convsRes, msgsRes] = await Promise.all([
    supabase
      .from('sales')
      .select('amount, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', todayISO()),

    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', todayISO()),

    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .in(
        'conversation_id',
        (
          await supabase
            .from('conversations')
            .select('id')
            .eq('tenant_id', tenantId)
        ).data?.map((c) => c.id) ?? []
      )
      .gte('created_at', todayISO()),
  ])

  const sales       = salesRes.data ?? []
  const confirmed   = sales.filter((s) => s.status === 'confirmed')
  const totalAmount = confirmed.reduce((sum, s) => sum + Number(s.amount), 0)
  const convRate    = sales.length > 0
    ? Math.round((confirmed.length / sales.length) * 100)
    : 0

  res.json({
    sales_today:        confirmed.length,
    revenue_today:      totalAmount,
    conversations_today: convsRes.count ?? 0,
    messages_sent_today: msgsRes.count  ?? 0,
    conversion_rate:    `${convRate}%`,
  })
})

// ─── GET /api/analytics/campaigns ────────────────────────────────────────────
router.get('/campaigns', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('id, name, meta_ad_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }

  // Traer ventas confirmadas con campaign_id en una sola query
  const { data: sales } = await supabase
    .from('sales')
    .select('campaign_id, amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .not('campaign_id', 'is', null)

  // Agrupar en JS para evitar N+1 queries
  const salesByCampaign = (sales ?? []).reduce<Record<string, { count: number; revenue: number }>>(
    (acc, s) => {
      const id = s.campaign_id as string
      acc[id] ??= { count: 0, revenue: 0 }
      acc[id].count   += 1
      acc[id].revenue += Number(s.amount)
      return acc
    },
    {}
  )

  const result = (campaigns ?? []).map((c) => ({
    id:           c.id,
    name:         c.name,
    meta_ad_id:   c.meta_ad_id,
    created_at:   c.created_at,
    sales_count:  salesByCampaign[c.id]?.count   ?? 0,
    total_revenue: salesByCampaign[c.id]?.revenue ?? 0,
  }))

  res.json(result)
})

// ─── GET /api/analytics/contacts ─────────────────────────────────────────────
router.get('/contacts', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const [totalRes, todayRes, activeRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),

    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', todayISO()),

    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .gte('last_message_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  res.json({
    total:             totalRes.count  ?? 0,
    new_today:         todayRes.count  ?? 0,
    active_last_7d:    activeRes.count ?? 0,
  })
})

export default router
