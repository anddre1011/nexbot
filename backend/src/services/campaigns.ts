import { supabase } from './supabase'

interface MetaReferral {
  source?: string       // URL del anuncio
  source_id?: string
  source_url?: string
  source_type?: string
  type?: string         // 'AD' | 'POST' | ...
  headline?: string     // título del anuncio
  ad_id?: string        // ID del anuncio en Meta
  ctwa_clid?: string    // click-to-WhatsApp click ID (para Conversions API)
}

interface ResolvedCampaign {
  campaignId: string | null
  ctwaClid: string | null
  metaAdId: string | null
}

async function findAutomationCampaignName(tenantId: string, metaAdId: string): Promise<string | null> {
  const { data } = await supabase
    .from('automation_campaigns')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('meta_ad_source_id', metaAdId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.name ?? null
}

// Extrae datos de referral del payload de Meta y devuelve el campaign_id en Supabase.
// Si el ad_id no existe aún, crea la campaña automáticamente.
export async function resolveCampaign(
  rawMessage: Record<string, unknown>,
  tenantId: string
): Promise<ResolvedCampaign> {
  const referral = rawMessage.referral as MetaReferral | undefined

  const metaAdId = referral?.ad_id ?? referral?.source_id ?? null
  const source = referral?.source ?? referral?.source_url ?? null

  if (!metaAdId && !source) {
    return { campaignId: null, ctwaClid: null, metaAdId: null }
  }

  const automationName = metaAdId ? await findAutomationCampaignName(tenantId, metaAdId) : null
  const headline  = automationName ?? referral?.headline ?? metaAdId ?? 'Campaña Meta'
  const ctwaClid  = referral?.ctwa_clid ?? null

  // Buscar campaña existente por meta_ad_id
  if (metaAdId) {
    const { data: existing } = await supabase
      .from('campaigns')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('meta_ad_id', metaAdId)
      .maybeSingle()

    if (existing) {
      if (automationName && existing.name !== automationName) {
        await supabase
          .from('campaigns')
          .update({ name: automationName })
          .eq('id', existing.id)
          .eq('tenant_id', tenantId)
      }
      return { campaignId: existing.id, ctwaClid, metaAdId }
    }
  }

  // No existe → crear campaña automáticamente
  const { data: created, error } = await supabase
    .from('campaigns')
    .insert({
      tenant_id:    tenantId,
      name:         headline,
      meta_ad_id:   metaAdId,
      meta_source:  source,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[campaigns] create error:', error.message)
    return { campaignId: null, ctwaClid, metaAdId }
  }

  console.log(`[campaigns] auto-created campaign "${headline}" (ad_id: ${metaAdId})`)
  return { campaignId: created.id, ctwaClid, metaAdId }
}

// Vincula una conversación a una campaña si aún no tiene una asignada.
export async function linkConversationToCampaign(
  conversationId: string,
  campaignId: string
) {
  await supabase
    .from('conversations')
    .update({ campaign_id: campaignId })
    .eq('id', conversationId)
    .is('campaign_id', null)   // no sobreescribir si ya tenía campaña
}

// Propaga el campaign_id de la conversación a la venta al confirmarla.
export async function propagateCampaignToSale(saleId: string, conversationId: string) {
  const { data: conv } = await supabase
    .from('conversations')
    .select('campaign_id')
    .eq('id', conversationId)
    .single()

  if (!conv?.campaign_id) return

  await supabase
    .from('sales')
    .update({ campaign_id: conv.campaign_id })
    .eq('id', saleId)
    .is('campaign_id', null)
}
