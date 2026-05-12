import { supabase } from './supabase'
import {
  sendTextMessage,
  sendImageMessage,
  sendVideoMessage,
  sendAudioMessage,
  sendDocumentMessage,
  type TenantCredentials,
} from './whatsapp'
import { propagateCampaignToSale } from './campaigns'

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface FlowStep {
  id: string
  flow_id: string
  position: number
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'delay' | 'wait_response'
  content: string | null
  media_url: string | null
  delay_ms: number
  buttons: unknown[]
}

interface FlowConversion {
  id: string
  flow_id: string
  function_name: string
  product_id: string | null
  kanban_stage: string
  disable_ai: boolean
  delivery_enabled: boolean
  confirm_message: string | null
  confirm_steps: unknown[]
}

interface FlowInactivityRule {
  id: string
  flow_id: string
  position: number
  delay_ms: number
  type: 'text' | 'image' | 'video' | 'media_var'
  content: string | null
  media_url: string | null
}

// ─── Ejecutar flujo de bienvenida ─────────────────────────────────────────────
// Ejecuta secuencialmente cada paso del flujo inicial (texto → delay → imagen → etc.)
export async function executeWelcomeFlow(
  flowId: string,
  contactPhone: string,
  conversationId: string,
  tenantId: string,
  creds?: TenantCredentials,
): Promise<void> {
  const { data: steps } = await supabase
    .from('flow_steps')
    .select('*')
    .eq('flow_id', flowId)
    .order('position', { ascending: true })

  if (!steps?.length) return

  for (const step of steps as FlowStep[]) {
    try {
      switch (step.type) {
        case 'text':
          if (step.content) {
            const resolvedText = await resolveMediaVars(step.content, tenantId)
            await sendTextMessage(contactPhone, resolvedText, creds)
            await saveOutbound(conversationId, 'text', resolvedText)
          }
          break

        case 'image':
          if (step.media_url) {
            await sendImageMessage(contactPhone, step.media_url, step.content ?? undefined, creds)
            await saveOutbound(conversationId, 'image', step.content ?? '[imagen]')
          }
          break

        case 'video':
          if (step.media_url) {
            await sendVideoMessage(contactPhone, step.media_url, step.content ?? undefined, creds)
            await saveOutbound(conversationId, 'video', step.content ?? '[video]')
          }
          break

        case 'audio':
          if (step.media_url) {
            await sendAudioMessage(contactPhone, step.media_url, creds)
            await saveOutbound(conversationId, 'audio', '[audio]')
          }
          break

        case 'file':
          if (step.media_url) {
            await sendDocumentMessage(contactPhone, step.media_url, step.content ?? 'archivo', creds)
            await saveOutbound(conversationId, 'document', step.content ?? '[archivo]')
          }
          break

        case 'delay':
          await sleep(step.delay_ms ?? 2000)
          break

        case 'wait_response':
          // Marcar el paso en el que estamos esperando respuesta
          await supabase
            .from('conversations')
            .update({ flow_step: step.position })
            .eq('id', conversationId)
          return // Salir del loop, esperar respuesta del usuario
      }
    } catch (err) {
      console.error(`[flow-engine] Error executing step ${step.position} (${step.type}):`, err)
    }
  }

  // Flujo completado: marcar como terminado
  await supabase
    .from('conversations')
    .update({ flow_step: -1 }) // -1 = flujo completado, IA toma el control
    .eq('id', conversationId)

  console.log(`[flow-engine] Welcome flow ${flowId} completed for conversation ${conversationId}`)
}

// ─── Ejecutar flujo de conversión ─────────────────────────────────────────────
// Se dispara cuando la IA detecta {{function:conversion}} en su respuesta
export async function executeConversionFlow(
  flowId: string,
  functionName: string,
  contactId: string,
  contactPhone: string,
  conversationId: string,
  tenantId: string,
  creds?: TenantCredentials,
): Promise<boolean> {
  // Buscar configuración de conversión
  const { data: conversion } = await supabase
    .from('flow_conversions')
    .select('*, products:product_id(name, price, delivery_url, currency)')
    .eq('flow_id', flowId)
    .eq('function_name', functionName)
    .single()

  if (!conversion) {
    console.warn(`[flow-engine] No conversion config for ${functionName} in flow ${flowId}`)
    return false
  }

  const conv = conversion as FlowConversion & {
    products: { name: string; price: number; delivery_url: string | null; currency: string } | null
  }

  try {
    // 1. Enviar mensaje de confirmación
    if (conv.confirm_message) {
      await sendTextMessage(contactPhone, conv.confirm_message, creds)
      await saveOutbound(conversationId, 'text', conv.confirm_message)
    }

    // 2. Vincular producto al contacto (registrar venta)
    if (conv.product_id && conv.products) {
      const { data: pendingSale } = await supabase
        .from('sales')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .eq('status', 'pending')
        .eq('amount', conv.products.price)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const saleResult = pendingSale?.id
        ? await supabase.from('sales').update({ status: 'confirmed' }).eq('id', pendingSale.id).select('id').single()
        : await supabase.from('sales').insert({
            tenant_id: tenantId,
            contact_id: contactId,
            product: conv.products.name,
            amount: conv.products.price,
            status: 'confirmed',
          }).select('id').single()

      if (saleResult.data?.id) {
        await propagateCampaignToSale(saleResult.data.id, conversationId)
      }

      // 3. Entregar producto automáticamente si tiene delivery_url
      if (conv.delivery_enabled && conv.products.delivery_url) {
        await sendTextMessage(contactPhone, conv.products.delivery_url, creds)
        await saveOutbound(conversationId, 'text', conv.products.delivery_url)
      }
    }

    // 4. Mover contacto en Kanban
    if (conv.kanban_stage) {
      await supabase
        .from('contacts')
        .update({ kanban_stage: conv.kanban_stage })
        .eq('id', contactId)
    }

    // 5. Desactivar IA si está configurado
    if (conv.disable_ai) {
      await supabase
        .from('conversations')
        .update({ ai_enabled: false, status: 'closed' })
        .eq('id', conversationId)
    }

    console.log(`[flow-engine] Conversion ${functionName} executed for contact ${contactId}`)
    return true
  } catch (err) {
    console.error(`[flow-engine] Error executing conversion ${functionName}:`, err)
    return false
  }
}

// ─── Resolver variables de media en texto ─────────────────────────────────────
// Reemplaza {{media:nombre}} con la URL real del archivo
export async function resolveMediaVars(text: string, tenantId: string): Promise<string> {
  const regex = /\{\{media:([^}]+)\}\}/g
  const matches = [...text.matchAll(regex)]

  if (matches.length === 0) return text

  let resolved = text
  for (const match of matches) {
    const varName = match[1]
    const fullVar = `{{media:${varName}}}`

    const { data: mediaRows2 } = await supabase
      .from('media')
      .select('url, type')
      .eq('tenant_id', tenantId)
      .eq('variable', fullVar)
      .order('created_at', { ascending: false })
      .limit(1)

    const mediaItem2 = Array.isArray(mediaRows2) ? mediaRows2[0] : mediaRows2
    if (mediaItem2?.url) {
      resolved = resolved.replace(fullVar, mediaItem2.url)
    }
  }

  return resolved
}

// ─── Detectar y ejecutar llamadas a funciones en respuesta de IA ──────────────
// Busca {{function:conversion}}, {{function:conversion2}}, etc.
// Retorna: { cleaned: texto sin tags, functions: funciones detectadas }
export function detectFunctionCalls(text: string): {
  cleaned: string
  functions: string[]
} {
  const regex = /\{\{\s*function:\s*([^}]+?)\s*\}\}/g
  const functions: string[] = []
  let cleaned = text

  const matches = [...text.matchAll(regex)]
  for (const match of matches) {
    functions.push(match[1])
    cleaned = cleaned.replace(match[0], '')
  }

  cleaned = cleaned.trim()
  return { cleaned, functions }
}

// ─── Detectar y resolver media tags en respuesta de IA ────────────────────────
// Retorna partes del mensaje separadas para enviar como multimedia
export async function resolveMediaTags(
  text: string,
  tenantId: string
): Promise<{
  parts: Array<{ type: 'text' | 'image' | 'video' | 'audio'; content: string }>
}> {
  const regex = /\{\{\s*media:\s*([^}]+?)\s*\}\}/g
  const parts: Array<{ type: 'text' | 'image' | 'video' | 'audio'; content: string }> = []

  let lastIndex = 0
  const matches = [...text.matchAll(regex)]

  for (const match of matches) {
    const before = text.slice(lastIndex, match.index).trim()
    if (before) parts.push({ type: 'text', content: before })

    const varName = match[1]
    const fullVar = `{{media:${varName}}}`

    const { data: mediaRows } = await supabase
      .from('media')
      .select('url, type')
      .eq('tenant_id', tenantId)
      .eq('variable', fullVar)
      .order('created_at', { ascending: false })
      .limit(1)

    const mediaItem = Array.isArray(mediaRows) ? mediaRows[0] : mediaRows
    if (mediaItem?.url) {
      parts.push({ type: mediaItem.type as 'image' | 'video' | 'audio', content: mediaItem.url })
    }

    lastIndex = (match.index ?? 0) + match[0].length
  }

  const after = text.slice(lastIndex).trim()
  if (after) parts.push({ type: 'text', content: after })

  if (parts.length === 0 && text.trim()) {
    parts.push({ type: 'text', content: text.trim() })
  }

  return { parts }
}

// ─── Buscar flujo activo de un tenant ─────────────────────────────────────────
export async function getActiveFlow(tenantId: string): Promise<{
  id: string
  name: string
  type: string
  model: string
  system_prompt: string | null
} | null> {
  const { data } = await supabase
    .from('flows')
    .select('id, name, type, model, system_prompt')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return data
}

export async function getFlowById(flowId: string, tenantId: string): Promise<{
  id: string
  name: string
  type: string
  model: string
  system_prompt: string | null
} | null> {
  const { data } = await supabase
    .from('flows')
    .select('id, name, type, model, system_prompt')
    .eq('id', flowId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  return data
}

// ─── Cargar reglas de inactividad de un flujo ─────────────────────────────────
export async function getInactivityRules(flowId: string): Promise<FlowInactivityRule[]> {
  const { data } = await supabase
    .from('flow_inactivity_rules')
    .select('*')
    .eq('flow_id', flowId)
    .order('position', { ascending: true })

  return (data ?? []) as FlowInactivityRule[]
}

// ─── Helpers internos ─────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function saveOutbound(conversationId: string, type: string, content: string) {
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    type,
    content,
  })
}
