import { supabase } from './supabase'
import { sendTextMessage, sendMediaByType, type TenantCredentials } from './whatsapp'
import { getInactivityRules, resolveMediaVars } from './flow-engine'

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ConversationTimers {
  timers: NodeJS.Timeout[]
  lastActivity: number        // timestamp ms del último mensaje
}

// En producción reemplazar con BullMQ o similar — los setTimeout se pierden al reiniciar
const activeTimers = new Map<string, ConversationTimers>()

// Ventana de 24h de WhatsApp (en ms)
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000

// ─── Verificar si estamos dentro del horario de operación ─────────────────────
async function isWithinBusinessHours(tenantId: string): Promise<boolean> {
  try {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('business_hours')
      .eq('id', tenantId)
      .single()

    if (!tenant?.business_hours) return true // Sin config = siempre permitido

    const hours = tenant.business_hours as Record<string, { start: string; end: string; enabled: boolean }>
    const now = new Date()
    // Usar timezone Bolivia (UTC-4)
    const boliviaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/La_Paz' }))
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    const dayConfig = hours[dayNames[boliviaTime.getDay()]]

    if (!dayConfig || !dayConfig.enabled) return false // Día deshabilitado

    const currentMinutes = boliviaTime.getHours() * 60 + boliviaTime.getMinutes()
    const [startH, startM] = dayConfig.start.split(':').map(Number)
    const [endH, endM] = dayConfig.end.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  } catch {
    return true // Error = permitir
  }
}

// ─── Iniciar timers de inactividad basados en flujo ───────────────────────────
export async function resetInactivityTimers(
  conversationId: string,
  contactPhone: string,
  flowId?: string,
  tenantId?: string,
  creds?: TenantCredentials,
) {
  // Limpiar timers previos
  clearInactivityTimers(conversationId)

  const now = Date.now()

  // Si no hay flujo, usar comportamiento por defecto
  if (!flowId || !tenantId) {
    const defaultFollowUp = setTimeout(async () => {
      await sendDefaultFollowUp(conversationId, contactPhone, creds)
    }, parseInt(process.env.FOLLOWUP_DELAY_MS ?? '3600000'))

    const defaultClose = setTimeout(async () => {
      await closeConversation(conversationId)
    }, parseInt(process.env.CLOSE_DELAY_MS ?? '86400000'))

    activeTimers.set(conversationId, {
      timers: [defaultFollowUp, defaultClose],
      lastActivity: now,
    })
    return
  }

  // Cargar reglas de inactividad del flujo
  const rules = await getInactivityRules(flowId)

  if (rules.length === 0) {
    // Sin reglas: usar defaults
    const defaultFollowUp = setTimeout(async () => {
      await sendDefaultFollowUp(conversationId, contactPhone, creds)
    }, parseInt(process.env.FOLLOWUP_DELAY_MS ?? '3600000'))

    activeTimers.set(conversationId, {
      timers: [defaultFollowUp],
      lastActivity: now,
    })
    return
  }

  // Crear un timer por cada regla
  const timers: NodeJS.Timeout[] = []

  for (const rule of rules) {
    const timer = setTimeout(async () => {
      // Verificar ventana de 24h
      const entry = activeTimers.get(conversationId)
      if (!entry) return

      const elapsed = Date.now() - entry.lastActivity
      if (elapsed > WHATSAPP_WINDOW_MS) {
        console.log(`[inactivity] 24h window expired for conv ${conversationId}, skipping`)
        return
      }

      // Verificar que la conversación sigue abierta
      const { data: conv } = await supabase
        .from('conversations')
        .select('status, ai_enabled')
        .eq('id', conversationId)
        .single()

      if (!conv || conv.status === 'closed') return

      try {
        // Verificar horario de operación antes de enviar
        if (tenantId && !(await isWithinBusinessHours(tenantId))) {
          console.log(`[inactivity] Outside business hours for conv ${conversationId}, skipping rule ${rule.position}`)
          return
        }

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
            // Resolver variable de media: {{media:videodemo}}
            if (rule.content && tenantId) {
              const resolved = await resolveMediaVars(rule.content, tenantId)
              if (resolved !== rule.content) {
                // Era una variable que se resolvió a URL
                const { data: media } = await supabase
                  .from('media')
                  .select('type, url')
                  .eq('tenant_id', tenantId)
                  .eq('variable', rule.content)
                  .single()

                if (media) {
                  await sendMediaByType(
                    contactPhone,
                    media.type as 'image' | 'video' | 'audio' | 'document',
                    media.url
                  )
                  await saveOutbound(conversationId, media.type, rule.content)
                }
              } else {
                // Es texto plano
                await sendTextMessage(contactPhone, resolved)
                await saveOutbound(conversationId, 'text', resolved)
              }
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

  // Timer de cierre a las 24h (siempre)
  const closeTimer = setTimeout(async () => {
    await closeConversation(conversationId)
  }, WHATSAPP_WINDOW_MS)
  timers.push(closeTimer)

  activeTimers.set(conversationId, { timers, lastActivity: now })
}

// ─── Limpiar todos los timers de una conversación ─────────────────────────────
export function clearInactivityTimers(conversationId: string) {
  const entry = activeTimers.get(conversationId)
  if (entry) {
    for (const t of entry.timers) clearTimeout(t)
    activeTimers.delete(conversationId)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sendDefaultFollowUp(conversationId: string, contactPhone: string, creds?: TenantCredentials) {
  const msg = '¡Hola! Solo quería saber si tienes alguna duda sobre nuestro producto. Estoy aquí para ayudarte. 😊'
  try {
    await sendTextMessage(contactPhone, msg, creds)
    await saveOutbound(conversationId, 'text', msg)
  } catch (err) {
    console.error(`[inactivity] follow-up error for conv ${conversationId}:`, err)
  }
}

async function closeConversation(conversationId: string) {
  try {
    await supabase
      .from('conversations')
      .update({ status: 'closed' })
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
