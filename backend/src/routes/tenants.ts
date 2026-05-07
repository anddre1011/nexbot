import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'

const router = Router()

router.use(requireAuth)

// Campos sensibles — se devuelven enmascarados al frontend
const SENSITIVE = ['openai_key', 'meta_token', 'webhook_verify_token', 'deepseek_key'] as const
type SensitiveField = (typeof SENSITIVE)[number]

function maskSensitive(tenant: Record<string, unknown>) {
  const out = { ...tenant }
  for (const field of SENSITIVE) {
    if (out[field]) out[field] = '••••••••'
  }
  return out
}

// ─── GET /api/tenants/settings ────────────────────────────────────────────────
router.get('/settings', async (_req, res) => {
  const { data, error } = await supabase
    .from('tenants')
    .select(
      'id, name, whatsapp_number, phone_number_id, webhook_verify_token, ' +
      'openai_key, meta_token, system_prompt, ' +
      'product_name, product_price, payment_methods, ' +
      'welcome_message, payment_confirmed_message, plan, active, deepseek_key'
    )
    .eq('user_id', res.locals.user.id)
    .single()

  if (error) {
    // Sin tenant aún → devolver vacío para que el frontend muestre el formulario
    if (error.code === 'PGRST116') { res.json(null); return }
    res.status(500).json({ error: error.message }); return
  }

  res.json(maskSensitive(data as unknown as Record<string, unknown>))
})

// ─── PUT /api/tenants/settings ────────────────────────────────────────────────
router.put('/settings', async (req, res) => {
  const {
    name,
    whatsapp_number,
    phone_number_id,
    webhook_verify_token,
    meta_token,
    openai_key,
    system_prompt,
    product_name,
    product_price,
    payment_methods,
    welcome_message,
    payment_confirmed_message,
  } = req.body

  // Construir objeto de update — omitir campos enmascarados (no sobreescribir con '••••••••')
  const updates: Record<string, unknown> = {
    name,
    whatsapp_number,
    phone_number_id:          phone_number_id          || null,
    webhook_verify_token:     webhook_verify_token     || null,
    system_prompt:            system_prompt            || null,
    product_name:             product_name             || null,
    product_price:            product_price != null ? Number(product_price) : null,
    payment_methods:          payment_methods          || null,
    welcome_message:          welcome_message          || null,
    payment_confirmed_message: payment_confirmed_message || null,
  }

  // Solo actualizar claves secretas si el usuario envió un valor real (no máscara)
  for (const field of SENSITIVE as unknown as SensitiveField[]) {
    const val = req.body[field] as string | undefined
    if (val && !val.startsWith('••')) updates[field] = val
  }

  // Upsert: crea el tenant si no existe, actualiza si ya existe
  const { data, error } = await supabase
    .from('tenants')
    .upsert({ ...updates, user_id: res.locals.user.id }, { onConflict: 'user_id' })
    .select('id, name, plan')
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }

  res.json({ ok: true, tenant: data })
})

export default router
