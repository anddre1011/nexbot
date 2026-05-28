import { supabase } from './supabase'
import { logger } from './logger'

type MetaEventInput = {
  tenantId: string
  eventType: string
  direction: 'incoming' | 'outgoing'
  endpoint?: string
  httpMethod?: string
  statusCode?: number
  requestPayload?: unknown
  responsePayload?: unknown
  durationMs?: number
  isError?: boolean
  errorMessage?: string
}

const SENSITIVE_KEYS = [
  'access_token',
  'authorization',
  'bearer',
  'deepseek_key',
  'meta_token',
  'openai_key',
  'password',
  'secret',
  'token',
  'whatsapp_token',
]

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated_depth]'
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitize(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const lower = key.toLowerCase()
      if (SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive))) {
        return [key, '[redacted]']
      }
      return [key, sanitize(entry, depth + 1)]
    })
  )
}

function truncatePayload(value: unknown): unknown {
  const safe = sanitize(value)
  const raw = JSON.stringify(safe)
  if (raw.length <= 20000) return safe
  return { truncated: true, size: raw.length }
}

export async function logMetaEvent(input: MetaEventInput): Promise<void> {
  try {
    const { error } = await supabase.from('meta_events_log').insert({
      tenant_id: input.tenantId,
      event_type: input.eventType,
      direction: input.direction,
      endpoint: input.endpoint ?? null,
      http_method: input.httpMethod ?? null,
      status_code: input.statusCode ?? null,
      request_payload: input.requestPayload === undefined ? null : truncatePayload(input.requestPayload),
      response_payload: input.responsePayload === undefined ? null : truncatePayload(input.responsePayload),
      duration_ms: input.durationMs ?? null,
      is_error: input.isError ?? false,
      error_message: input.errorMessage ?? null,
    })

    if (error) {
      logger.warn('[meta-events] log skipped', { reason: error.message, eventType: input.eventType })
    }
  } catch (err) {
    logger.warn('[meta-events] log failed', { reason: err instanceof Error ? err.message : String(err) })
  }
}

export function sanitizeForLog(value: unknown): unknown {
  return truncatePayload(value)
}
