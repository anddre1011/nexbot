import { supabase } from './supabase'
import { logger } from './logger'
import { decryptSecret } from './crypto.service'
import { logMetaEvent } from './meta-events'

const GRAPH_VERSION = 'v21.0'
const PARTNER_AGENT = 'nexbot'

// Ventana de atribución de Meta para CTWA: 7 días.
const ATTRIBUTION_WINDOW_HOURS = 24 * 7

type CapiEventName =
  | 'Purchase'
  | 'Lead'
  | 'CompleteRegistration'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'Subscribe'
  | 'Contact'

type QueueConversionInput = {
  tenantId: string
  contactId: string
  conversationId?: string | null
  eventName?: CapiEventName
  value?: number | null
  currency?: string
  productIds?: string[]
  productNames?: string[]
  numItems?: number
  orderId?: string | null
  markedVia?: 'manual' | 'api' | 'flow' | 'auto'
  markedByUserId?: string | null
  notes?: string | null
}

type CapiSettings = {
  dataset_id: string
  token: string
  test_event_code: string | null
}

// ─── Leer y desencriptar la configuración CAPI del tenant ─────────────────────
async function getCapiSettings(tenantId: string): Promise<CapiSettings | null> {
  const { data, error } = await supabase
    .from('tenant_meta_settings')
    .select('capi_dataset_id, capi_token_encrypted, capi_test_event_code, capi_status')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    logger.warn('[capi] settings lookup failed', { tenantId, reason: error.message })
    return null
  }

  if (!data?.capi_dataset_id || !data?.capi_token_encrypted) return null
  if (data.capi_status === 'inactive') return null

  let token: string | null = null
  try {
    token = decryptSecret(data.capi_token_encrypted)
  } catch (err) {
    logger.warn('[capi] token decrypt failed', {
      tenantId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  if (!token) return null

  return {
    dataset_id: data.capi_dataset_id,
    token,
    test_event_code: data.capi_test_event_code ?? null,
  }
}

// ─── Encolar una conversión ───────────────────────────────────────────────────
// Se llama cuando se confirma una venta. Crea la fila en `conversions` y
// dispara el envío sin bloquear el flujo del bot.
export async function queueConversion(input: QueueConversionInput): Promise<string | null> {
  const {
    tenantId,
    contactId,
    conversationId = null,
    eventName = 'Purchase',
    value = null,
    currency = 'BOB',
    productIds,
    productNames,
    numItems,
    orderId = null,
    markedVia = 'flow',
    markedByUserId = null,
    notes = null,
  } = input

  // Recuperar el ctwa_clid capturado cuando el contacto escribió por primera vez
  const { data: contact } = await supabase
    .from('contacts')
    .select('ctwa_clid, ctwa_clid_captured_at')
    .eq('id', contactId)
    .maybeSingle()

  const ctwaClid = contact?.ctwa_clid ?? null

  let ageHours: number | null = null
  if (ctwaClid && contact?.ctwa_clid_captured_at) {
    const capturedAt = new Date(contact.ctwa_clid_captured_at).getTime()
    ageHours = Math.floor((Date.now() - capturedAt) / 3_600_000)
  }

  // Sin ctwa_clid no hay atribución posible: se guarda igual para reportes internos
  const initialStatus = ctwaClid ? 'pending' : 'no_attribution'

  const { data: conversion, error } = await supabase
    .from('conversions')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      conversation_id: conversationId,
      event_name: eventName,
      event_time: new Date().toISOString(),
      value,
      currency,
      ctwa_clid: ctwaClid,
      ctwa_clid_age_hours: ageHours,
      product_ids: productIds ?? null,
      product_names: productNames ?? null,
      num_items: numItems ?? null,
      order_id: orderId,
      status: initialStatus,
      marked_via: markedVia,
      marked_by_user_id: markedByUserId,
      notes,
    })
    .select('id')
    .single()

  if (error) {
    logger.warn('[capi] queue failed', { tenantId, contactId, reason: error.message })
    return null
  }

  if (initialStatus === 'no_attribution') {
    logger.info('[capi] conversion without ctwa_clid — stored, not sent', {
      conversionId: conversion.id,
      contactId,
    })
    return conversion.id
  }

  // Envío en background: nunca bloquea la respuesta al cliente en WhatsApp
  sendConversion(conversion.id).catch((err) => {
    logger.warn('[capi] background send failed', {
      conversionId: conversion.id,
      reason: err instanceof Error ? err.message : String(err),
    })
  })

  return conversion.id
}

// ─── Enviar una conversión a Meta ─────────────────────────────────────────────
export async function sendConversion(conversionId: string): Promise<boolean> {
  const startedAt = Date.now()

  const { data: conv, error } = await supabase
    .from('conversions')
    .select('*')
    .eq('id', conversionId)
    .single()

  if (error || !conv) {
    logger.warn('[capi] conversion not found', { conversionId })
    return false
  }

  if (conv.status === 'sent' || conv.status === 'cancelled') return true
  if (!conv.ctwa_clid) {
    await supabase.from('conversions').update({ status: 'no_attribution' }).eq('id', conversionId)
    return false
  }

  const settings = await getCapiSettings(conv.tenant_id)
  if (!settings) {
    await supabase
      .from('conversions')
      .update({
        status: 'failed',
        attempts: (conv.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        meta_response: { error: 'CAPI no configurado para este tenant' },
      })
      .eq('id', conversionId)
    logger.warn('[capi] tenant has no CAPI config', { tenantId: conv.tenant_id, conversionId })
    return false
  }

  await supabase.from('conversions').update({ status: 'sending' }).eq('id', conversionId)

  // Payload según spec de Conversions API for Business Messaging
  const eventPayload: Record<string, unknown> = {
    event_name: conv.event_name,
    event_time: Math.floor(new Date(conv.event_time).getTime() / 1000),
    event_id: conv.event_id, // idempotencia — evita doble conteo si reintentamos
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      ctwa_clid: conv.ctwa_clid,
    },
  }

  if (conv.value !== null && conv.value !== undefined) {
    eventPayload.custom_data = {
      currency: conv.currency,
      value: Number(conv.value),
      ...(conv.order_id ? { order_id: conv.order_id } : {}),
      ...(conv.product_ids?.length ? { content_ids: conv.product_ids } : {}),
      ...(conv.product_names?.length ? { content_name: conv.product_names.join(', ') } : {}),
      ...(conv.num_items ? { num_items: conv.num_items } : {}),
    }
  }

  const body: Record<string, unknown> = {
    data: [eventPayload],
    partner_agent: PARTNER_AGENT,
  }
  if (settings.test_event_code) body.test_event_code = settings.test_event_code

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${settings.dataset_id}/events`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(body),
    })

    const json = await res.json().catch(() => ({})) as {
      error?: unknown
      events_received?: unknown
      fbtrace_id?: string | null
      [key: string]: unknown
    }
    const durationMs = Date.now() - startedAt

    await logMetaEvent({
      tenantId: conv.tenant_id,
      eventType: `capi_${conv.event_name}`,
      direction: 'outgoing',
      endpoint: url,
      httpMethod: 'POST',
      statusCode: res.status,
      requestPayload: body,
      responsePayload: json,
      durationMs,
      isError: !res.ok,
      errorMessage: res.ok ? undefined : JSON.stringify(json?.error ?? {}),
    })

    if (res.ok) {
      await supabase
        .from('conversions')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: (conv.attempts ?? 0) + 1,
          last_attempt_at: new Date().toISOString(),
          meta_response: json,
          meta_event_received_id: json?.events_received != null ? String(json.events_received) : null,
          meta_fbtrace_id: json?.fbtrace_id ?? null,
          next_retry_at: null,
        })
        .eq('id', conversionId)

      await supabase
        .from('tenant_meta_settings')
        .update({ capi_last_event_sent_at: new Date().toISOString(), capi_status: 'active' })
        .eq('tenant_id', conv.tenant_id)

      logger.info('[capi] event sent', {
        conversionId,
        eventName: conv.event_name,
        value: conv.value,
        received: json?.events_received,
      })
      return true
    }

    // Error: programar reintento con backoff exponencial
    const attempts = (conv.attempts ?? 0) + 1
    const shouldRetry = attempts < 5 && res.status >= 500 // 4xx normalmente no se arregla reintentando
    const backoffMin = Math.min(2 ** attempts * 5, 240)

    await supabase
      .from('conversions')
      .update({
        status: shouldRetry ? 'retrying' : 'failed',
        attempts,
        last_attempt_at: new Date().toISOString(),
        next_retry_at: shouldRetry ? new Date(Date.now() + backoffMin * 60_000).toISOString() : null,
        meta_response: json,
        meta_fbtrace_id: json?.fbtrace_id ?? null,
      })
      .eq('id', conversionId)

    logger.warn('[capi] send failed', { conversionId, status: res.status, error: json?.error })
    return false
  } catch (err) {
    const attempts = (conv.attempts ?? 0) + 1
    const shouldRetry = attempts < 5
    const backoffMin = Math.min(2 ** attempts * 5, 240)

    await supabase
      .from('conversions')
      .update({
        status: shouldRetry ? 'retrying' : 'failed',
        attempts,
        last_attempt_at: new Date().toISOString(),
        next_retry_at: shouldRetry ? new Date(Date.now() + backoffMin * 60_000).toISOString() : null,
        meta_response: { error: err instanceof Error ? err.message : String(err) },
      })
      .eq('id', conversionId)

    logger.warn('[capi] send exception', {
      conversionId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ─── Worker de reintentos ─────────────────────────────────────────────────────
// Se arranca desde index.ts junto al inactivity worker.
export function startCapiRetryWorker(intervalMs = 5 * 60_000): void {
  setInterval(async () => {
    try {
      const { data: pending } = await supabase
        .from('conversions')
        .select('id')
        .in('status', ['pending', 'retrying'])
        .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
        .lt('attempts', 5)
        .limit(25)

      if (!pending?.length) return

      logger.info('[capi] retry batch', { count: pending.length })
      for (const row of pending) {
        await sendConversion(row.id)
        await new Promise((r) => setTimeout(r, 300))
      }
    } catch (err) {
      logger.warn('[capi] retry worker error', {
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }, intervalMs)

  logger.info('[capi] retry worker started')
}

export { ATTRIBUTION_WINDOW_HOURS }
