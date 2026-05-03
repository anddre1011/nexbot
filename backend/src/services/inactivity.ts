import { supabase } from './supabase'
import { sendTextMessage } from './whatsapp'

interface ConversationTimers {
  followUp: NodeJS.Timeout
  close: NodeJS.Timeout
}

// En producción reemplazar con BullMQ o similar — los setTimeout se pierden al reiniciar
const timers = new Map<string, ConversationTimers>()

const FOLLOWUP_DELAY = parseInt(process.env.FOLLOWUP_DELAY_MS ?? '3600000')  // 1h
const CLOSE_DELAY    = parseInt(process.env.CLOSE_DELAY_MS    ?? '86400000') // 24h

export function resetInactivityTimers(conversationId: string, contactPhone: string) {
  clearExisting(conversationId)

  const followUp = setTimeout(async () => {
    await sendFollowUp(conversationId, contactPhone)
  }, FOLLOWUP_DELAY)

  const close = setTimeout(async () => {
    await closeConversation(conversationId)
  }, CLOSE_DELAY)

  timers.set(conversationId, { followUp, close })
}

export function clearInactivityTimers(conversationId: string) {
  clearExisting(conversationId)
}

function clearExisting(conversationId: string) {
  const existing = timers.get(conversationId)
  if (existing) {
    clearTimeout(existing.followUp)
    clearTimeout(existing.close)
    timers.delete(conversationId)
  }
}

async function sendFollowUp(conversationId: string, contactPhone: string) {
  const msg = '¡Hola! Solo quería saber si tienes alguna duda sobre nuestro producto. Estoy aquí para ayudarte. 😊'

  try {
    await sendTextMessage(contactPhone, msg)
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      type: 'text',
      content: msg,
    })
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

    timers.delete(conversationId)
    console.log(`[inactivity] conversation ${conversationId} closed after 24h`)
  } catch (err) {
    console.error(`[inactivity] close error for conv ${conversationId}:`, err)
  }
}
