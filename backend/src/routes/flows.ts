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

// ─── GET /api/flows ───────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data, error } = await supabase
    .from('flows')
    .select('id, name, type, model, system_prompt, handoff_agent_name, welcome_items, inactivity_messages, executions, active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── POST /api/flows ──────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { name, type, model, system_prompt, handoff_agent_name, welcome_items, inactivity_messages } = req.body
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
    })
    .select('id, name, type, model, executions, active, created_at')
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
    .select('id, name, type, model, executions, active').single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json(data)
})

// ─── DELETE /api/flows/:id ────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('flows').delete().eq('id', req.params.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true })
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

export default router
