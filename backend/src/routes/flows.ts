import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()
router.use(requireAuth)

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants').select('id').eq('user_id', userId).eq('active', true).single()
  return data?.id ?? null
}

// ═══════════════════════════════════════════════════════════════════
// FLUJOS (base)
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/flows ───────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('flows')
    .select('id, name, type, model, system_prompt, handoff_agent_name, welcome_items, inactivity_messages, conversion_enabled, conversion_message, executions, active, tags, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, type, model, system_prompt, handoff_agent_name, welcome_items, inactivity_messages, tags } = req.body
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return }

  const { data, error } = await supabase
    .from('flows')
    .insert({
      tenant_id:           tenantId,
      name:                name.trim(),
      type:                type                ?? 'ai',
      model:               model               ?? 'gpt-4o',
      system_prompt:       system_prompt       ?? null,
      handoff_agent_name:  handoff_agent_name  ?? null,
      welcome_items:       welcome_items       ?? [],
      inactivity_messages: inactivity_messages ?? [],
      tags:                tags                ?? [],
    })
    .select('id, name, type, model, executions, active, tags, created_at')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/flows/:id ─────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'type', 'model', 'system_prompt', 'handoff_agent_name', 'welcome_items', 'inactivity_messages', 'active', 'conversion_enabled', 'conversion_message', 'conversion_product_id', 'tags'] as const
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }
  if (!Object.keys(updates).length) { res.status(400).json({ error: 'No fields to update' }); return }

  const { data, error } = await supabase
    .from('flows').update(updates).eq('id', req.params.id)
    .select('id, name, type, model, executions, active, tags').single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/flows/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('flows').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════
// FLOW STEPS  (PUT reemplaza todo, GET lista)
// ════════════════════════════════════════════════════════════
router.get('/:id/steps', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_steps').select('*').eq('flow_id', req.params.id).order('position')
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data ?? [])
})

router.put('/:id/steps', async (req, res) => {
  const steps: unknown[] = req.body ?? []
  await supabase.from('flow_steps').delete().eq('flow_id', req.params.id)
  if (!steps.length) { res.json([]); return }
  const rows = (steps as Record<string,unknown>[]).map((s, i) => ({
    flow_id: req.params.id, position: i,
    type: s.type, content: s.content ?? null,
    media_url: s.media_url ?? null, delay_ms: s.delay_ms ?? 2000, buttons: s.buttons ?? [],
  }))
  const { data, error } = await supabase.from('flow_steps').insert(rows).select()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ════════════════════════════════════════════════════════════
// FLOW CONVERSIONS
// ════════════════════════════════════════════════════════════
router.get('/:id/conversions', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_conversions').select('*, products(id,name,price,currency,delivery_url)')
    .eq('flow_id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data ?? [])
})

router.put('/:id/conversions', async (req, res) => {
  const conversions: unknown[] = req.body ?? []
  await supabase.from('flow_conversions').delete().eq('flow_id', req.params.id)
  if (!conversions.length) { res.json([]); return }
  const rows = (conversions as Record<string,unknown>[]).map((c) => ({
    flow_id: req.params.id,
    function_name:    c.function_name ?? 'conversion',
    product_id:       c.product_id    ?? null,
    kanban_stage:     c.kanban_stage  ?? 'converted',
    disable_ai:       c.disable_ai    ?? true,
    delivery_enabled: c.delivery_enabled ?? true,
    confirm_message:  c.confirm_message ?? null,
    confirm_steps:    c.confirm_steps   ?? [],
  }))
  const { data, error } = await supabase.from('flow_conversions').insert(rows).select()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ════════════════════════════════════════════════════════════
// FLOW INACTIVITY RULES
// ════════════════════════════════════════════════════════════
router.get('/:id/inactivity-rules', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_inactivity_rules').select('*').eq('flow_id', req.params.id).order('position')
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data ?? [])
})

router.put('/:id/inactivity-rules', async (req, res) => {
  const rules: unknown[] = req.body ?? []
  await supabase.from('flow_inactivity_rules').delete().eq('flow_id', req.params.id)
  if (!rules.length) { res.json([]); return }
  const rows = (rules as Record<string,unknown>[]).map((r, i) => ({
    flow_id: req.params.id, position: i,
    delay_ms:  r.delay_ms  ?? 10800000,
    type:      r.type      ?? 'text',
    content:   r.content   ?? null,
    media_url: r.media_url ?? null,
  }))
  const { data, error } = await supabase.from('flow_inactivity_rules').insert(rows).select()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows/generate-prompt ─────────────────────────────────────────
router.post('/generate-prompt', async (req, res) => {
  const { product_name, product_price, payment_methods, business_name } = req.body
  if (!product_name) { res.status(400).json({ error: 'product_name required' }); return }

  const { openai } = await import('../services/openai')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Genera un prompt de sistema para un agente de ventas de WhatsApp con estos datos:
Negocio: ${business_name ?? 'Mi Negocio'}
Producto: ${product_name}
Precio: ${product_price ?? 'a consultar'}
Métodos de pago: ${payment_methods ?? 'transferencia bancaria'}

El prompt debe:
- Ser en español, tono amigable y profesional
- Indicar el objetivo: responder dudas y cerrar la venta
- Incluir las variables {{product_name}}, {{price}}, {{payment_methods}}
- Tener reglas claras: respuestas cortas (max 3 oraciones), indicar precio cuando pregunten
- Máximo 150 palabras

Responde SOLO con el prompt, sin explicación.`,
    }],
  })

  res.json({ prompt: completion.choices[0].message.content?.trim() ?? '' })
})

// ═══════════════════════════════════════════════════════════════════
// FLOW STEPS (pasos del flujo inicial)
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/flows/:id/steps ─────────────────────────────────────────────────
router.get('/:id/steps', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_steps')
    .select('*')
    .eq('flow_id', req.params.id)
    .order('position', { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows/:id/steps ────────────────────────────────────────────────
router.post('/:id/steps', async (req, res) => {
  const { type, content, media_url, delay_ms, buttons, position } = req.body
  if (!type) { res.status(400).json({ error: 'type is required' }); return }

  // Auto-calcular posición si no se provee
  let pos = position
  if (pos == null) {
    const { data: maxPos } = await supabase
      .from('flow_steps')
      .select('position')
      .eq('flow_id', req.params.id)
      .order('position', { ascending: false })
      .limit(1)
      .single()
    pos = (maxPos?.position ?? -1) + 1
  }

  const { data, error } = await supabase
    .from('flow_steps')
    .insert({
      flow_id:   req.params.id,
      type,
      content:   content   ?? null,
      media_url: media_url ?? null,
      delay_ms:  delay_ms  ?? 2000,
      buttons:   buttons   ?? [],
      position:  pos,
    })
    .select('*')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/flows/:flowId/steps/:stepId ───────────────────────────────────
router.patch('/:flowId/steps/:stepId', async (req, res) => {
  const allowed = ['type', 'content', 'media_url', 'delay_ms', 'buttons', 'position']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { data, error } = await supabase
    .from('flow_steps')
    .update(updates)
    .eq('id', req.params.stepId)
    .eq('flow_id', req.params.flowId)
    .select('*')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── PUT /api/flows/:id/steps/reorder ─────────────────────────────────────────
router.put('/:id/steps/reorder', async (req, res) => {
  const { order } = req.body as { order: string[] } // array de IDs en nuevo orden
  if (!Array.isArray(order)) { res.status(400).json({ error: 'order array required' }); return }

  const promises = order.map((stepId, i) =>
    supabase.from('flow_steps').update({ position: i }).eq('id', stepId).eq('flow_id', req.params.id)
  )
  await Promise.all(promises)
  res.json({ ok: true })
})

// ─── DELETE /api/flows/:flowId/steps/:stepId ──────────────────────────────────
router.delete('/:flowId/steps/:stepId', async (req, res) => {
  const { error } = await supabase
    .from('flow_steps')
    .delete()
    .eq('id', req.params.stepId)
    .eq('flow_id', req.params.flowId)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════
// FLOW CONVERSIONS ({{function:conversion}})
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/flows/:id/conversions ───────────────────────────────────────────
router.get('/:id/conversions', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_conversions')
    .select('*, products:product_id(id, name, price, currency, delivery_url)')
    .eq('flow_id', req.params.id)
    .order('position', { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows/:id/conversions ──────────────────────────────────────────
router.post('/:id/conversions', async (req, res) => {
  const { function_name, product_id, kanban_stage, disable_ai, delivery_enabled, confirm_message, confirm_steps } = req.body
  if (!function_name) { res.status(400).json({ error: 'function_name is required' }); return }

  const { data, error } = await supabase
    .from('flow_conversions')
    .insert({
      flow_id:           req.params.id,
      function_name:     function_name,
      product_id:        product_id       ?? null,
      kanban_stage:      kanban_stage      ?? 'converted',
      disable_ai:        disable_ai        ?? true,
      delivery_enabled:  delivery_enabled  ?? true,
      confirm_message:   confirm_message   ?? null,
      confirm_steps:     confirm_steps      ?? [],
    })
    .select('*, products:product_id(id, name, price, currency, delivery_url)')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/flows/:flowId/conversions/:convId ─────────────────────────────
router.patch('/:flowId/conversions/:convId', async (req, res) => {
  const allowed = ['function_name', 'product_id', 'kanban_stage', 'disable_ai', 'delivery_enabled', 'confirm_message', 'confirm_steps']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { data, error } = await supabase
    .from('flow_conversions')
    .update(updates)
    .eq('id', req.params.convId)
    .eq('flow_id', req.params.flowId)
    .select('*, products:product_id(id, name, price, currency)')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/flows/:flowId/conversions/:convId ────────────────────────────
router.delete('/:flowId/conversions/:convId', async (req, res) => {
  const { error } = await supabase
    .from('flow_conversions')
    .delete()
    .eq('id', req.params.convId)
    .eq('flow_id', req.params.flowId)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════
// FLOW INACTIVITY RULES
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/flows/:id/inactivity-rules ──────────────────────────────────────
router.get('/:id/inactivity-rules', async (req, res) => {
  const { data, error } = await supabase
    .from('flow_inactivity_rules')
    .select('*')
    .eq('flow_id', req.params.id)
    .order('position', { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows/:id/inactivity-rules ─────────────────────────────────────
router.post('/:id/inactivity-rules', async (req, res) => {
  const { delay_ms, type, content, media_url, position } = req.body
  if (!delay_ms || !type) { res.status(400).json({ error: 'delay_ms and type required' }); return }

  let pos = position
  if (pos == null) {
    const { data: maxPos } = await supabase
      .from('flow_inactivity_rules')
      .select('position')
      .eq('flow_id', req.params.id)
      .order('position', { ascending: false })
      .limit(1)
      .single()
    pos = (maxPos?.position ?? -1) + 1
  }

  const { data, error } = await supabase
    .from('flow_inactivity_rules')
    .insert({
      flow_id:   req.params.id,
      delay_ms,
      type,
      content:   content   ?? null,
      media_url: media_url ?? null,
      position:  pos,
    })
    .select('*')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json(data)
})

// ─── PATCH /api/flows/:flowId/inactivity-rules/:ruleId ────────────────────────
router.patch('/:flowId/inactivity-rules/:ruleId', async (req, res) => {
  const allowed = ['delay_ms', 'type', 'content', 'media_url', 'position']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const { data, error } = await supabase
    .from('flow_inactivity_rules')
    .update(updates)
    .eq('id', req.params.ruleId)
    .eq('flow_id', req.params.flowId)
    .select('*')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/flows/:flowId/inactivity-rules/:ruleId ───────────────────────
router.delete('/:flowId/inactivity-rules/:ruleId', async (req, res) => {
  const { error } = await supabase
    .from('flow_inactivity_rules')
    .delete()
    .eq('id', req.params.ruleId)
    .eq('flow_id', req.params.flowId)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
})

export default router
