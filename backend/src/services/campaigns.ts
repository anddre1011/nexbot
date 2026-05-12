import { supabase } from './supabase'

interface MetaReferral {
  source?: string       // URL del anuncio
  source_url?: string
  source_id?: string
  type?: string         // 'AD' | 'POST' | ...
  headline?: string     // título del anuncio
  ad_id?: string        // ID del anuncio en Meta
  ctwa_clid?: string    // click-to-WhatsApp click ID (para Conversions API)
}

interface ResolvedCampaign {
  campaignId: string | null
  flowId: string | null
  ctwaClid: string | null
}

// Extrae datos de referral del payload de Meta y devuelve el campaign_id en Supabase.
// Si el ad_id no existe aún, crea la campaña automáticamente.
export async function resolveCampaign(
  rawMessage: Record<string, unknown>,
  tenantId: string
): Promise<ResolvedCampaign> {
  const referral = rawMessage.referral as MetaReferral | undefined

  if (!referral?.ad_id && !referral?.source_id && !referral?.source && !referral?.source_url) {
    return { campaignId: null, flowId: null, ctwaClid: null }
  }

  const metaAdId  = referral.ad_id ?? referral.source_id ?? null
  const source    = referral.source ?? referral.source_url ?? null
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

    if (existing) {
      const flowId = await resolveAutomationFlow(tenantId, metaAdId, source)
      return { campaignId: existing.id, flowId, ctwaClid }
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
    return { campaignId: null, flowId: null, ctwaClid }
  }

  console.log(`[campaigns] auto-created campaign "${headline}" (ad_id: ${metaAdId})`)
  const flowId = await resolveAutomationFlow(tenantId, metaAdId, source)
  return { campaignId: created.id, flowId, ctwaClid }
}

async function resolveAutomationFlow(
  tenantId: string,
  metaAdId: string | null,
  source: string | null
): Promise<string | null> {
  const ids = [metaAdId, source].filter(Boolean) as string[]
  if (!ids.length) return null

  const { data } = await supabase
    .from('automation_campaigns')
    .select('id, flow_id, executions, meta_ad_source_id, source_ids')
    .eq('tenant_id', tenantId)
    .eq('active', true)

  const match = (data ?? []).find((item) => {
    const sources = [
      item.meta_ad_source_id,
      ...((item.source_ids as string[] | null) ?? []),
    ].filter(Boolean)

    return ids.some((id) => sources.includes(id))
  })

  if (!match?.flow_id) return null

  await supabase
    .from('automation_campaigns')
    .update({ executions: (match.executions ?? 0) + 1 })
    .eq('id', match.id)

  return match.flow_id as string
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
