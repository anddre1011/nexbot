import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { fetchCampaigns, fetchInsights, updateCampaignStatus } from '../services/meta-ads'

const router = Router()
router.use(requireAuth)

async function getTenant(userId: string) {
  const { data } = await supabase
    .from('tenants')
    .select('id, meta_ads_token, meta_ads_account_id')
    .eq('user_id', userId)
    .eq('active', true)
    .single()
  return data
}

// ─── POST /api/meta-ads/connect ───────────────────────────────────────────────
router.post('/connect', async (req, res) => {
  const { token, account_id } = req.body
  if (!token?.trim() || !account_id?.trim()) {
    res.status(400).json({ error: 'token and account_id are required' }); return
  }

  // Verificar token llamando a la API antes de guardar
  try {
    await fetchCampaigns(token.trim(), account_id.trim())
  } catch {
    res.status(400).json({ error: 'Token o Account ID inválido. Verifica tus credenciales.' }); return
  }

  const tenant = await getTenant(res.locals.user.id)
  if (!tenant) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { error } = await supabase
    .from('tenants')
    .update({ meta_ads_token: token.trim(), meta_ads_account_id: account_id.trim() })
    .eq('id', tenant.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ─── GET /api/meta-ads/status ─────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  const tenant = await getTenant(res.locals.user.id)
  res.json({ connected: !!(tenant?.meta_ads_token && tenant?.meta_ads_account_id) })
})

// ─── GET /api/meta-ads/campaigns ─────────────────────────────────────────────
// ?date_preset=today|last_7d|last_30d|this_month
router.get('/campaigns', async (req, res) => {
  const tenant = await getTenant(res.locals.user.id)
  if (!tenant?.meta_ads_token || !tenant?.meta_ads_account_id) {
    res.status(401).json({ error: 'Meta Ads not connected' }); return
  }

  const datePreset = (req.query.date_preset as string) ?? 'last_30d'

  try {
    const [campaigns, insights] = await Promise.all([
      fetchCampaigns(tenant.meta_ads_token, tenant.meta_ads_account_id),
      fetchInsights(tenant.meta_ads_token, tenant.meta_ads_account_id, datePreset),
    ])

    // Traer stats de ventas de Supabase por campaign.meta_ad_id
    const { data: saleStats } = await supabase.rpc('campaign_stats', { p_tenant_id: tenant.id })

    // Indexar por campaign_id para merge O(1)
    const insightMap  = Object.fromEntries(insights.map((i) => [i.campaign_id, i]))
    const saleMap     = Object.fromEntries(
      ((saleStats as Array<{ campaign_id: string; sales_count: number; total_revenue: number }>) ?? [])
        .map((s) => [s.campaign_id, s])
    )

    // Buscar la campaña de Supabase que coincide con el meta_ad_id
    const { data: dbCampaigns } = await supabase
      .from('campaigns')
      .select('id, meta_ad_id')
      .eq('tenant_id', tenant.id)

    const metaToDb = Object.fromEntries(
      (dbCampaigns ?? []).map((c) => [c.meta_ad_id, c.id])
    )

    const result = campaigns.map((c) => {
      const insight  = insightMap[c.id]
      const dbId     = metaToDb[c.id]
      const sale     = dbId ? saleMap[dbId] : null
      const spend    = parseFloat(insight?.spend ?? '0')
      const revenue  = sale?.total_revenue ?? 0
      const roas     = spend > 0 ? +(revenue / spend).toFixed(2) : null

      return {
        id:              c.id,
        name:            c.name,
        status:          c.status,
        spend:           spend,
        impressions:     parseInt(insight?.impressions ?? '0'),
        clicks:          parseInt(insight?.clicks ?? '0'),
        ctr:             parseFloat(insight?.ctr ?? '0'),
        leads:           sale?.sales_count ?? 0,
        conversions:     sale?.sales_count ?? 0,
        revenue,
        roas,
        daily_budget:    c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
      }
    })

    res.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Meta API error'
    res.status(502).json({ error: msg })
  }
})

// ─── PATCH /api/meta-ads/campaigns/:id ───────────────────────────────────────
router.patch('/campaigns/:id', async (req, res) => {
  const tenant = await getTenant(res.locals.user.id)
  if (!tenant?.meta_ads_token) { res.status(401).json({ error: 'Not connected' }); return }

  const { status } = req.body
  if (!['ACTIVE', 'PAUSED'].includes(status)) {
    res.status(400).json({ error: 'status must be ACTIVE or PAUSED' }); return
  }

  try {
    const ok = await updateCampaignStatus(tenant.meta_ads_token, req.params.id, status)
    res.json({ ok })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Meta API error' })
  }
})

// ─── DELETE /api/meta-ads/disconnect ─────────────────────────────────────────
router.delete('/disconnect', async (_req, res) => {
  const tenant = await getTenant(res.locals.user.id)
  if (!tenant) { res.status(404).json({ error: 'Tenant not found' }); return }

  await supabase.from('tenants')
    .update({ meta_ads_token: null, meta_ads_account_id: null })
    .eq('id', tenant.id)

  res.json({ ok: true })
})

export default router
