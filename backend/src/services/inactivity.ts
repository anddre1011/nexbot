import { supabase } from './supabase'
import { sendTextMessage, sendMediaByType, type TenantCredentials } from './whatsapp'
import { getInactivityRules, resolveMediaVars } from './flow-engine'

type ConversationState = {
  status: string | null
  ai_enabled: boolean | null
}

type ScheduledInactivityJob = {
  id: string
  tenant_id: string
  conversation_id: string
  contact_phone: string
  kind: 'text' | 'image' | 'video' | 'media_var' | 'close'
  content: string | null
  media_url: string | null
  attempts: number
  created_at: string
}

type BusinessDay = {
  start?: string
  end?: string
  enabled?: boolean
}

type BusinessHours = Record<string, BusinessDay>

type ConversationSeed = {
  id: string
  tenant_id: string
  flow_id: string | null
  contacts?: { phone?: string | null } | Array<{ phone?: string | null }> | null
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000
const CLOSE_DELAY_MS = parseInt(process.env.CLOSE_DELAY_MS ?? '86400000')
const FOLLOWUP_DELAY_MS = parseInt(process.env.FOLLOWUP_DELAY_MS ?? '3600000')
const INACTIVITY_SEND_STATUSES = new Set(['bot', 'open'])
const WORKER_INTERVAL_MS = parseInt(process.env.INACTIVITY_WORKER_INTERVAL_MS ?? '60000')
const MAX_JOBS_PER_TICK = parseInt(process.env.INACTIVITY_MAX_JOBS_PER_TICK ?? '25')
const BUSINESS_DAY_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const
const BOLIVIA_OFFSET_MS = 4 * 60 * 60 * 1000

let workerStarted = false

export async function resetInactivityTimers(
  conversationId: string,
  contactPhone: string,
  flowId?: string,
  tenantId?: string,
  _creds?: TenantCredentials,
) {
  if (!tenantId) return

  try {
    await clearInactivityTimers(conversationId)
    await scheduleInactivityJobs(conversationId, contactPhone, tenantId, flowId, Date.now(), false)
  } catch (err) {
    console.error(`[inactivity] schedule error for conv ${conversationId}:`, err)
  }
}

export async function clearInactivityTimers(conversationId: string) {
  const { error } = await supabase
    .from('scheduled_inactivity_jobs')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')

  if (error) {
    console.error(`[inactivity] Could not cancel jobs for conv ${conversationId}:`, error.message)
  }
}

export function startInactivityWorker() {
  if (workerStarted) return
  workerStarted = true

  setInterval(() => {
    void processDueInactivityJobs()
  }, WORKER_INTERVAL_MS)

  void bootstrapOpenConversations()
  void processDueInactivityJobs()
  console.log(`[inactivity] Worker started (${WORKER_INTERVAL_MS}ms interval)`)
}

async function scheduleInactivityJobs(
  conversationId: string,
  contactPhone: string,
  tenantId: string,
  flowId: string | undefined,
  anchorMs: number,
  sendOverdueNow: boolean,
) {
  const now = Date.now()
  const jobs: Array<{
    tenant_id: string
    conversation_id: string
    contact_phone: string
    flow_id: string | null
    rule_id: string | null
    kind: string
    content: string | null
    media_url: string | null
    due_at: string
  }> = []
  let flowHasConfiguredRules = false
  const businessHours = await getTenantBusinessHours(tenantId)

  if (flowId) {
    const rules = await getInactivityRules(flowId)
    const { data: sentJobs } = await supabase
      .from('scheduled_inactivity_jobs')
      .select('rule_id')
      .eq('conversation_id', conversationId)
      .eq('status', 'sent')
      .not('rule_id', 'is', null)

    const sentRuleIds = new Set((sentJobs ?? []).map((job: any) => job.rule_id).filter(Boolean))
    flowHasConfiguredRules = rules.some((rule) => rule.delay_ms < WHATSAPP_WINDOW_MS)
    const eligibleRules = rules.filter((rule) => {
      const eligible = rule.delay_ms < WHATSAPP_WINDOW_MS
      if (!eligible) {
        console.log(`[inactivity] Rule ${rule.id} skipped while scheduling because it is outside the 24h window`)
      }
      return eligible && !sentRuleIds.has(rule.id)
    })
    const overdueRules = sendOverdueNow
      ? eligibleRules.filter((rule) => anchorMs + rule.delay_ms <= now)
      : []
    const futureRules = sendOverdueNow
      ? eligibleRules.filter((rule) => anchorMs + rule.delay_ms > now)
      : eligibleRules
    const rulesToSchedule = overdueRules.length
      ? [overdueRules[overdueRules.length - 1], ...futureRules]
      : futureRules

    let previousRuleDelay = 0
    let previousDueMs = 0

    for (const rule of rulesToSchedule) {
      const originalDueMs = anchorMs + rule.delay_ms
      const minimumDueMs = previousDueMs > 0
        ? previousDueMs + Math.max(60000, rule.delay_ms - previousRuleDelay)
        : originalDueMs
      const targetDueMs = sendOverdueNow && originalDueMs <= now ? now + 5000 : Math.max(originalDueMs, minimumDueMs)
      const dueMs = nextBusinessTimeMs(targetDueMs, businessHours)

      previousRuleDelay = rule.delay_ms
      previousDueMs = dueMs

      if (dueMs > anchorMs + WHATSAPP_WINDOW_MS) {
        console.log(`[inactivity] Rule ${rule.id} skipped because business hours move it outside the 24h window`)
        continue
      }

      jobs.push({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_phone: contactPhone,
        flow_id: flowId,
        rule_id: rule.id,
        kind: rule.type,
        content: rule.content,
        media_url: rule.media_url,
        due_at: new Date(dueMs).toISOString(),
      })
    }

    if (jobs.length === 0 && flowHasConfiguredRules) {
      console.log(`[inactivity] No pending inactivity rules left for conv ${conversationId}`)
    }
  }

  if (jobs.length === 0 && !flowHasConfiguredRules) {
    const fallbackDueMs = anchorMs + FOLLOWUP_DELAY_MS
    const dueMs = nextBusinessTimeMs(sendOverdueNow && fallbackDueMs <= now ? now + 5000 : fallbackDueMs, businessHours)
    if (dueMs <= anchorMs + WHATSAPP_WINDOW_MS) {
      jobs.push({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_phone: contactPhone,
        flow_id: flowId ?? null,
        rule_id: null,
        kind: 'text',
        content: 'Hola, solo queria saber si tienes alguna duda sobre el producto. Estoy aqui para ayudarte.',
        media_url: null,
        due_at: new Date(dueMs).toISOString(),
      })
    } else {
      console.log(`[inactivity] Fallback follow-up skipped because business hours move it outside the 24h window`)
    }
  }

  const closeDueMs = anchorMs + Math.min(CLOSE_DELAY_MS, WHATSAPP_WINDOW_MS)
  jobs.push({
    tenant_id: tenantId,
    conversation_id: conversationId,
    contact_phone: contactPhone,
    flow_id: flowId ?? null,
    rule_id: null,
    kind: 'close',
    content: null,
    media_url: null,
    due_at: new Date(sendOverdueNow && closeDueMs <= now ? now + 10000 : closeDueMs).toISOString(),
  })

  const { error } = await supabase.from('scheduled_inactivity_jobs').insert(jobs)
  if (error) {
    console.error(`[inactivity] Could not schedule jobs for conv ${conversationId}:`, error.message)
    return
  }

  console.log(`[inactivity] Scheduled ${jobs.length} jobs for conv ${conversationId}`)
}

async function bootstrapOpenConversations() {
  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, tenant_id, flow_id, contacts(phone)')
    .in('status', ['bot', 'open'])
    .eq('ai_enabled', true)
    .not('flow_id', 'is', null)
    .limit(200)

  if (error) {
    console.error('[inactivity] Bootstrap query error:', error.message)
    return
  }

  for (const conversation of (conversations ?? []) as ConversationSeed[]) {
    const { data: existingJob } = await supabase
      .from('scheduled_inactivity_jobs')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle()

    if (existingJob) continue

    const { data: lastInbound } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversation.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const createdAt = (lastInbound as { created_at?: string } | null)?.created_at
    if (!createdAt) continue

    const anchorMs = new Date(createdAt).getTime()
    if (Date.now() - anchorMs >= WHATSAPP_WINDOW_MS) {
      await closeConversation(conversation.id)
      continue
    }

    const contact = Array.isArray(conversation.contacts) ? conversation.contacts[0] : conversation.contacts
    const phone = contact?.phone
    if (!phone || !conversation.flow_id) continue

    await scheduleInactivityJobs(conversation.id, phone, conversation.tenant_id, conversation.flow_id, anchorMs, true)
  }
}

async function processDueInactivityJobs() {
  const { data: jobs, error } = await supabase
    .from('scheduled_inactivity_jobs')
    .select('id, tenant_id, conversation_id, contact_phone, kind, content, media_url, attempts, created_at')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(MAX_JOBS_PER_TICK)

  if (error) {
    console.error('[inactivity] Worker query error:', error.message)
    return
  }

  for (const job of (jobs ?? []) as ScheduledInactivityJob[]) {
    await processInactivityJob(job)
  }
}

async function processInactivityJob(job: ScheduledInactivityJob) {
  const claimed = await claimJob(job.id)
  if (!claimed) return

  try {
    if (job.kind === 'close') {
      if (await hasNewerInboundMessage(job.conversation_id, job.created_at)) {
        await markJobSkipped(job.id, 'newer inbound message')
        return
      }

      await closeConversation(job.conversation_id)
      await markJobDone(job.id)
      return
    }

    const businessHours = await getTenantBusinessHours(job.tenant_id)
    const allowedAtMs = nextBusinessTimeMs(Date.now(), businessHours)
    if (allowedAtMs > Date.now() + 30000) {
      await postponeClaimedJob(job.id, allowedAtMs)
      return
    }

    const conv = await getConversationState(job.conversation_id)
    if (!canSendInactivity(conv)) {
      await markJobSkipped(job.id, `status=${conv?.status ?? 'missing'}, ai=${conv?.ai_enabled ?? 'missing'}`)
      return
    }

    if (await hasNewerInboundMessage(job.conversation_id, job.created_at)) {
      await markJobSkipped(job.id, 'newer inbound message')
      return
    }

    const creds = await getTenantCredentials(job.tenant_id)
    await sendScheduledJob(job, creds)
    await markJobDone(job.id)
  } catch (err) {
    await markJobFailed(job, err)
  }
}

async function sendScheduledJob(job: ScheduledInactivityJob, creds?: TenantCredentials) {
  switch (job.kind) {
    case 'text': {
      if (!job.content) return
      const resolved = await resolveMediaVars(job.content, job.tenant_id)
      await sendTextMessage(job.contact_phone, resolved, creds)
      await saveOutbound(job.conversation_id, 'text', resolved)
      return
    }

    case 'image':
    case 'video': {
      if (!job.media_url) return
      await sendMediaByType(job.contact_phone, job.kind, job.media_url, job.content ?? undefined, creds)
      await saveOutbound(job.conversation_id, job.kind, job.media_url)
      return
    }

    case 'media_var': {
      if (!job.content) return
      await sendMediaRule(job.conversation_id, job.contact_phone, job.tenant_id, job.content, creds)
      return
    }
  }
}

async function sendMediaRule(
  conversationId: string,
  contactPhone: string,
  tenantId: string,
  content: string,
  creds?: TenantCredentials,
) {
  const resolved = await resolveMediaVars(content, tenantId)

  if (resolved === content) {
    await sendTextMessage(contactPhone, resolved, creds)
    await saveOutbound(conversationId, 'text', resolved)
    return
  }

  const { data: media } = await supabase
    .from('media')
    .select('type, url')
    .eq('tenant_id', tenantId)
    .eq('variable', content)
    .maybeSingle()

  if (!media) {
    console.warn(`[inactivity] Media variable not found: ${content}`)
    return
  }

  await sendMediaByType(
    contactPhone,
    media.type as 'image' | 'video' | 'audio' | 'document',
    media.url,
    undefined,
    creds,
  )
  await saveOutbound(conversationId, media.type, content)
}

async function closeConversation(conversationId: string) {
  const conv = await getConversationState(conversationId)
  if (!conv || ['closed', 'converted', 'disqualified', 'abandoned'].includes(conv.status ?? '')) return

  await supabase
    .from('conversations')
    .update({ status: 'closed', ai_enabled: false })
    .eq('id', conversationId)

  console.log(`[inactivity] conversation ${conversationId} closed after inactivity window`)
}

async function claimJob(id: string) {
  const { data, error } = await supabase
    .from('scheduled_inactivity_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[inactivity] Could not claim job ${id}:`, error.message)
    return false
  }

  return Boolean(data)
}

async function markJobDone(id: string) {
  await supabase
    .from('scheduled_inactivity_jobs')
    .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
}

async function postponeClaimedJob(id: string, dueAtMs: number) {
  await supabase
    .from('scheduled_inactivity_jobs')
    .update({
      status: 'pending',
      due_at: new Date(dueAtMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
}

async function markJobSkipped(id: string, reason: string) {
  await supabase
    .from('scheduled_inactivity_jobs')
    .update({ status: 'skipped', error: reason, updated_at: new Date().toISOString() })
    .eq('id', id)
}

async function markJobFailed(job: ScheduledInactivityJob, err: unknown) {
  const attempts = job.attempts + 1
  const message = err instanceof Error ? err.message : String(err)
  const nextStatus = attempts >= 3 ? 'failed' : 'pending'
  const retryAt = new Date(Date.now() + Math.min(15 * 60 * 1000, attempts * 60 * 1000)).toISOString()
  const updates: Record<string, unknown> = {
    status: nextStatus,
    attempts,
    error: message,
    updated_at: new Date().toISOString(),
  }

  if (nextStatus === 'pending') {
    updates.due_at = retryAt
  }

  await supabase
    .from('scheduled_inactivity_jobs')
    .update(updates)
    .eq('id', job.id)

  console.error(`[inactivity] Job ${job.id} failed:`, message)
}

async function saveOutbound(conversationId: string, type: string, content: string) {
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    type,
    content,
  })
}

async function getConversationState(conversationId: string): Promise<ConversationState | null> {
  const { data } = await supabase
    .from('conversations')
    .select('status, ai_enabled')
    .eq('id', conversationId)
    .maybeSingle()

  return data as ConversationState | null
}

async function hasNewerInboundMessage(conversationId: string, createdAt: string) {
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .gt('created_at', createdAt)
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

async function getTenantCredentials(tenantId: string): Promise<TenantCredentials> {
  const { data } = await supabase
    .from('tenants')
    .select('meta_token, phone_number_id')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    metaToken: (data as any)?.meta_token ?? null,
    phoneNumberId: (data as any)?.phone_number_id ?? null,
  }
}

async function getTenantBusinessHours(tenantId: string): Promise<BusinessHours | null> {
  const { data, error } = await supabase
    .from('tenants')
    .select('business_hours')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    console.error(`[inactivity] Could not load business hours for tenant ${tenantId}:`, error.message)
    return null
  }

  return ((data as any)?.business_hours ?? null) as BusinessHours | null
}

function nextBusinessTimeMs(targetMs: number, hours: BusinessHours | null) {
  if (!hours) return targetMs

  let cursorMs = targetMs
  for (let i = 0; i < 8; i++) {
    const local = toBoliviaLocal(cursorMs)
    const key = BUSINESS_DAY_KEYS[local.day]
    const config = hours[key]

    if (!config?.enabled) {
      cursorMs = boliviaLocalToUtcMs(local.year, local.month, local.date + 1, 0, 0)
      continue
    }

    const start = parseHour(config.start ?? '00:00')
    const end = parseHour(config.end ?? '23:59')
    if (end <= start) {
      cursorMs = boliviaLocalToUtcMs(local.year, local.month, local.date + 1, 0, 0)
      continue
    }

    if (local.minuteOfDay < start) {
      return boliviaLocalToUtcMs(local.year, local.month, local.date, Math.floor(start / 60), start % 60)
    }

    if (local.minuteOfDay < end) {
      return cursorMs
    }

    cursorMs = boliviaLocalToUtcMs(local.year, local.month, local.date + 1, 0, 0)
  }

  return targetMs
}

function toBoliviaLocal(utcMs: number) {
  const d = new Date(utcMs - BOLIVIA_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    day: d.getUTCDay(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

function boliviaLocalToUtcMs(year: number, month: number, date: number, hour: number, minute: number) {
  return Date.UTC(year, month, date, hour, minute) + BOLIVIA_OFFSET_MS
}

function parseHour(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
}

function canSendInactivity(conv: ConversationState | null) {
  if (!conv?.status) return false
  if (!INACTIVITY_SEND_STATUSES.has(conv.status)) return false
  return conv.ai_enabled !== false
}
