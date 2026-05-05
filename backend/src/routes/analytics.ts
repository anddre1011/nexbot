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

// ─── GET /api/analytics/overview ─────────────────────────────────────────────
// KPIs principales para el dashboard
router.get('/overview', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const from = (req.query.from as string) || todayISO()
  const to   = (req.query.to   as string) || new Date().toISOString()

  const [convsRes, salesRes, contactsRes, flowsRes] = await Promise.all([
    supabase.from('conversations').select('id, status').eq('tenant_id', tenantId).gte('created_at', from).lte('created_at', to),
    supabase.from('sales').select('amount, status, product, campaign_id').eq('tenant_id', tenantId).gte('created_at', from).lte('created_at', to),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', from).lte('created_at', to),
    supabase.from('flows').select('executions').eq('tenant_id', tenantId),
  ])

  const convs = convsRes.data ?? []
  const sales = salesRes.data ?? []
  const confirmed = sales.filter(s => s.status === 'confirmed')
  const totalRevenue = confirmed.reduce((sum, s) => sum + Number(s.amount), 0)
  const iaAttending = convs.filter(c => c.status === 'bot' || c.status === 'open').length
  const convRate = convs.length > 0 ? ((confirmed.length / convs.length) * 100).toFixed(1) : '0'
  const totalExec = (flowsRes.data ?? []).reduce((s, f) => s + (f.executions ?? 0), 0)

  res.json({
    conversations_total: convs.length,
    ia_attending: iaAttending,
    conversion_rate: `${convRate}%`,
    product_value: totalRevenue,
    sales_count: confirmed.length,
    clients: contactsRes.count ?? 0,
    total_executions: totalExec,
  })
})

// ─── GET /api/analytics/kanban-distribution ──────────────────────────────────
router.get('/kanban-distribution', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: convs } = await supabase
    .from('conversations')
    .select('status')
    .eq('tenant_id', tenantId)

  const dist: Record<string, number> = {}
  for (const c of convs ?? []) {
    const s = c.status ?? 'open'
    dist[s] = (dist[s] ?? 0) + 1
  }
  res.json(dist)
})

// ─── GET /api/analytics/top-products ─────────────────────────────────────────
router.get('/top-products', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: sales } = await supabase
    .from('sales')
    .select('product, amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')

  const byProduct: Record<string, { count: number; revenue: number }> = {}
  for (const s of sales ?? []) {
    const p = s.product ?? 'Sin producto'
    byProduct[p] ??= { count: 0, revenue: 0 }
    byProduct[p].count += 1
    byProduct[p].revenue += Number(s.amount)
  }

  const result = Object.entries(byProduct)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  res.json(result)
})

// ─── GET /api/analytics/contacts-evolution ───────────────────────────────────
router.get('/contacts-evolution', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const days = parseInt(req.query.days as string) || 30
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const { data: contacts } = await supabase
    .from('contacts')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  const byDay: Record<string, number> = {}
  for (const c of contacts ?? []) {
    const day = c.created_at.slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + 1
  }

  res.json(Object.entries(byDay).map(([date, count]) => ({ date, count })))
})

// ─── GET /api/analytics/leads-by-campaign ────────────────────────────────────
router.get('/leads-by-campaign', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('tenant_id', tenantId)

  const { data: sales } = await supabase
    .from('sales')
    .select('campaign_id, amount, status')
    .eq('tenant_id', tenantId)

  const { data: convs } = await supabase
    .from('conversations')
    .select('campaign_id')
    .eq('tenant_id', tenantId)
    .not('campaign_id', 'is', null)

  const leadsByC: Record<string, number> = {}
  for (const c of convs ?? []) { if (c.campaign_id) leadsByC[c.campaign_id] = (leadsByC[c.campaign_id] ?? 0) + 1 }

  const salesByC: Record<string, { conv: number; revenue: number }> = {}
  for (const s of sales ?? []) {
    if (!s.campaign_id) continue
    salesByC[s.campaign_id] ??= { conv: 0, revenue: 0 }
    if (s.status === 'confirmed') {
      salesByC[s.campaign_id].conv += 1
      salesByC[s.campaign_id].revenue += Number(s.amount)
    }
  }

  const result = (campaigns ?? []).map(c => {
    const leads = leadsByC[c.id] ?? 0
    const conv = salesByC[c.id]?.conv ?? 0
    const revenue = salesByC[c.id]?.revenue ?? 0
    const rate = leads > 0 ? ((conv / leads) * 100).toFixed(1) : '0'
    return { name: c.name, leads, conversions: conv, rate: `${rate}%`, revenue }
  }).sort((a, b) => b.leads - a.leads).slice(0, 20)

  res.json(result)
})

export default router
