import { supabase } from './supabase'
import { logger } from './logger'

type CtwaAttribution = {
  ctwa_clid?: string
  ctwa_source_id?: string
  ctwa_source_url?: string
  ctwa_source_type?: string
  ctwa_header_text?: string
  ctwa_body_text?: string
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function extractCtwaAttribution(raw: Record<string, unknown>): CtwaAttribution | null {
  const referral = raw.referral as Record<string, unknown> | undefined
  if (!referral) return null

  const attribution: CtwaAttribution = {
    ctwa_clid: asText(referral.ctwa_clid),
    ctwa_source_id: asText(referral.source_id),
    ctwa_source_url: asText(referral.source_url),
    ctwa_source_type: asText(referral.source_type),
    ctwa_header_text: asText(referral.headline) ?? asText(referral.header_text),
    ctwa_body_text: asText(referral.body) ?? asText(referral.body_text),
  }

  return Object.values(attribution).some(Boolean) ? attribution : null
}

export async function captureCtwaAttribution(
  contactId: string,
  raw: Record<string, unknown>
): Promise<CtwaAttribution | null> {
  const attribution = extractCtwaAttribution(raw)
  if (!attribution) return null

  const updatePayload = {
    ...attribution,
    ctwa_clid_captured_at: attribution.ctwa_clid ? new Date().toISOString() : undefined,
  }

  const { error } = await supabase
    .from('contacts')
    .update(updatePayload)
    .eq('id', contactId)

  if (error) {
    logger.warn('[attribution] CTWA capture skipped', { contactId, reason: error.message })
    return attribution
  }

  logger.info('[attribution] CTWA captured', {
    contactId,
    hasClid: Boolean(attribution.ctwa_clid),
    sourceId: attribution.ctwa_source_id,
  })
  return attribution
}
