import { supabase } from './supabase'
import { sendTextMessage, sendMediaByType, type TenantCredentials } from './whatsapp'
import { getInactivityRules, resolveMediaVars } from './flow-engine'

interface ConversationTimers {
  timers: NodeJS.Timeout[]
  lastActivity: number
}

type ConversationState = {
  status: string | null
  ai_enabled: boolean | null
}

const activeTimers = new Map<string, ConversationTimers>()

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000
const CLOSE_DELAY_MS = parseInt(process.env.CLOSE_DELAY_MS ?? '86400000')
const FOLLOWUP_DELAY_MS = parseInt(process.env.FOLLOWUP_DELAY_MS ?? '3600000')
const INACTIVITY_SEND_STATUSES = new Set(['bot', 'open'])

export async function resetInactivityTimers(
  conversationId: string,
  contactPhone: string,
  flowId?: string,
  tenantId?: string,
  creds?: TenantCredentials,
) {
  clearInactivityTimers(conversationId)

  const now = Date.now()

  if (!flowId || !tenantId) {
    const defaultFollowUp = setTimeout(async () => {
      await sendDefaultFollowUp(conversationId, contactPhone, creds)
    }, FOLLOWUP_DELAY_MS)

    const defaultClose = setTimeout(async () => {
      await closeConversation(conversationId)
    }, CLOSE_DELAY_MS)

    activeTimers.set(conversationId, {
      timers: [defaultFollowUp, defaultClose],
      lastActivity: now,
    })
    return
  }

  const rules = await getInactivityRules(flowId)

  if (rules.length === 0) {
    const defaultFollowUp = setTimeout(async () => {
      await sendDefaultFollowUp(conversationId, contactPhone, creds)
    }, FOLLOWUP_DELAY_MS)

    const defaultClose = setTimeout(async () => {
      await closeConversation(conversationId)
    }, CLOSE_DELAY_MS)

    activeTimers.set(conversationId, {
      timers: [defaultFollowUp, defaultClose],
      lastActivity: now,
    })
    return
  }

  const timers: NodeJS.Timeout[] = []

  for (const rule of rules) {
    const timer = setTimeout(async () => {
      const entry = activeTimers.get(conversationId)
      if (!entry) return

      const elapsed = Date.now() - entry.lastActivity
      if (elapsed > WHATSAPP_WINDOW_MS) {
        console.log(`[inactivity] 24h window expired for conv ${conversationId}, skipping`)
        return
      }

      const conv = await getConversationState(conversationId)
      if (!canSendInactivity(conv)) {
        console.log(`[inactivity] Rule ${rule.position} skipped for conv ${conversationId} (status=${conv?.status ?? 'missing'}, ai=${conv?.ai_enabled ?? 'missing'})`)
        return
      }

      try {
        switch (rule.type) {
          case 'text':
            if (rule.content) {
              const resolved = await resolveMediaVars(rule.content, tenantId)
              await sendTextMessage(contactPhone, resolved, creds)
              await saveOutbound(conversationId, 'text', resolved)
            }
            break

          case 'image':
          case 'video':
            if (rule.media_url) {
              await sendMediaByType(contactPhone, rule.type, rule.media_url, rule.content ?? undefined, creds)
              await saveOutbound(conversationId, rule.type, rule.content ?? `[${rule.type}]`)
            }
            break

          case 'media_var':
            if (rule.content) {
              await sendMediaRule(conversationId, contactPhone, tenantId, rule.content, creds)
            }
            break
        }

        console.log(`[inactivity] Rule ${rule.position} fired for conv ${conversationId} (${rule.type}, ${rule.delay_ms}ms)`)
      } catch (err) {
        console.error(`[inactivity] Error firing rule ${rule.position} for conv ${conversationId}:`, err)
      }
    }, rule.delay_ms)

    timers.push(timer)
  }

  const closeTimer = setTimeout(async () => {
    await closeConversation(conversationId)
  }, WHATSAPP_WINDOW_MS)
  timers.push(closeTimer)

  activeTimers.set(conversationId, { timers, lastActivity: now })
}

export function clearInactivityTimers(conversationId: string) {
  const entry = activeTimers.get(conversationId)
  if (entry) {
    for (const t of entry.timers) clearTimeout(t)
    activeTimers.delete(conversationId)
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

async function sendDefaultFollowUp(conversationId: string, contactPhone: string, creds?: TenantCredentials) {
  const conv = await getConversationState(conversationId)
  if (!canSendInactivity(conv)) {
    console.log(`[inactivity] Default follow-up skipped for conv ${conversationId} (status=${conv?.status ?? 'missing'}, ai=${conv?.ai_enabled ?? 'missing'})`)
    return
  }

  const msg = 'Hola, solo queria saber si tienes alguna duda sobre el producto. Estoy aqui para ayudarte.'
  try {
    await sendTextMessage(contactPhone, msg, creds)
    await saveOutbound(conversationId, 'text', msg)
  } catch (err) {
    console.error(`[inactivity] follow-up error for conv ${conversationId}:`, err)
  }
}

async function closeConversation(conversationId: string) {
  try {
    const conv = await getConversationState(conversationId)
    if (!conv || ['closed', 'converted', 'disqualified', 'abandoned'].includes(conv.status ?? '')) {
      activeTimers.delete(conversationId)
      return
    }

    await supabase
      .from('conversations')
      .update({ status: 'closed', ai_enabled: false })
      .eq('id', conversationId)

    activeTimers.delete(conversationId)
    console.log(`[inactivity] conversation ${conversationId} closed after 24h`)
  } catch (err) {
    console.error(`[inactivity] close error for conv ${conversationId}:`, err)
  }
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

function canSendInactivity(conv: ConversationState | null) {
  if (!conv?.status) return false
  if (!INACTIVITY_SEND_STATUSES.has(conv.status)) return false
  return conv.ai_enabled !== false
}
