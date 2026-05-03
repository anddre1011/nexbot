import { supabase } from './supabase'

interface MetaReferral {
  source?: string       // URL del anuncio
  type?: string         // 'AD' | 'POST' | ...
  headline?: string     // título del anuncio
  ad_id?: string        // ID del anuncio en Meta
  ctwa_clid?: string    // click-to-WhatsApp click ID (para Conversions API)
}

interface ResolvedCampaign {
  campaignId: string | null
  ctwaClid: string | null
}

// Extrae datos de referral del payload de Meta y devuelve el campaign_id en Supabase.
// Si el ad_id no existe aún, crea la campaña automáticamente.
export async function resolveCampaign(
  rawMessage: Record<string, unknown>,
  tenantId: string
): Promise<ResolvedCampaign> {
  const referral = rawMessage.referral as MetaReferral | undefined

  if (!referral?.ad_id && !referral?.source) {
    return { campaignId: null, ctwaClid: null }
  }

  const metaAdId  = referral.ad_id   ?? null
  const source    = referral.source  ?? null
  const headline  = referral.headline ?? metaAdId ?? 'Campaña Meta'
  const ctwaClid  = referral.ctwa_clid ?? null

  // Buscar campaña existente por meta_ad_id
  if (metaAdId) {
    const { data: existing } = await supabase
      .from('campaigns')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('meta_ad_id', metaAdId)
      .single()

    if (existing) return { campaignId: existing.id, ctwaClid }
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
    return { campaignId: null, ctwaClid }
  }

  console.log(`[campaigns] auto-created campaign "${headline}" (ad_id: ${metaAdId})`)
  return { campaignId: created.id, ctwaClid }
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
