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

// ─── POST /api/tenants/connect-whatsapp ──────────────────────────────────────
// Automatiza TODA la configuración de webhooks de Meta
router.post('/connect-whatsapp', async (req, res) => {
  const { meta_token, phone_number_id, whatsapp_number, webhook_verify_token } = req.body

  if (!meta_token || !phone_number_id) {
    return res.status(400).json({ error: 'meta_token y phone_number_id son obligatorios' })
  }

  const userId = res.locals.user.id
  const results: { step: string; status: string; detail?: string }[] = []

  try {
    // ── PASO 1: Validar token con Meta ──
    let wabaId: string | null = null
    try {
      const tokenCheck = await fetch(
        `https://graph.facebook.com/v20.0/${phone_number_id}?fields=verified_name,display_phone_number`,
        { headers: { Authorization: `Bearer ${meta_token}` } }
      )
      const tokenData = await tokenCheck.json()

      if (!tokenCheck.ok) {
        return res.status(400).json({
          error: `Token inválido o sin permisos: ${tokenData.error?.message ?? 'Error desconocido'}`,
          step: 'validate_token',
        })
      }

      results.push({
        step: 'validate_token',
        status: 'ok',
        detail: `Número verificado: ${tokenData.display_phone_number ?? tokenData.verified_name ?? phone_number_id}`,
      })
    } catch (err: any) {
      return res.status(500).json({ error: `Error al validar token: ${err.message}`, step: 'validate_token' })
    }

    // ── PASO 2: Obtener WABA ID ──
    try {
      const wabaRes = await fetch(
        `https://graph.facebook.com/v20.0/${phone_number_id}?fields=account_id`,
        { headers: { Authorization: `Bearer ${meta_token}` } }
      )
      const wabaData = await wabaRes.json()

      if (wabaData.account_id) {
        wabaId = wabaData.account_id
        results.push({ step: 'get_waba_id', status: 'ok', detail: `WABA ID: ${wabaId}` })
      } else {
        // Intentar buscar por shared WABAs
        const sharedRes = await fetch(
          `https://graph.facebook.com/v20.0/${phone_number_id}/whatsapp_business_account`,
          { headers: { Authorization: `Bearer ${meta_token}` } }
        )
        const sharedData = await sharedRes.json()
        wabaId = sharedData?.id ?? null

        if (wabaId) {
          results.push({ step: 'get_waba_id', status: 'ok', detail: `WABA ID (shared): ${wabaId}` })
        } else {
          results.push({ step: 'get_waba_id', status: 'warning', detail: 'No se pudo obtener WABA ID automáticamente' })
        }
      }
    } catch {
      results.push({ step: 'get_waba_id', status: 'warning', detail: 'No se pudo obtener WABA ID' })
    }

    // ── PASO 3: Suscribir App a webhooks (subscribed_apps) ──
    if (wabaId) {
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${meta_token}`,
              'Content-Type': 'application/json',
            },
          }
        )
        const subData = await subRes.json()

        if (subData.success) {
          results.push({ step: 'subscribe_webhooks', status: 'ok', detail: 'App suscrita a webhooks correctamente' })
        } else {
          results.push({
            step: 'subscribe_webhooks',
            status: 'error',
            detail: subData.error?.message ?? 'No se pudo suscribir',
          })
        }
      } catch (err: any) {
        results.push({ step: 'subscribe_webhooks', status: 'error', detail: err.message })
      }
    } else {
      results.push({ step: 'subscribe_webhooks', status: 'skipped', detail: 'Sin WABA ID — necesitas suscribir manualmente' })
    }

    // ── PASO 4: Registrar número de teléfono ──
    try {
      const regRes = await fetch(
        `https://graph.facebook.com/v20.0/${phone_number_id}/register`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${meta_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messaging_product: 'whatsapp', pin: '123456' }),
        }
      )
      const regData = await regRes.json()

      if (regData.success || regRes.ok) {
        results.push({ step: 'register_phone', status: 'ok', detail: 'Número registrado en Meta API' })
      } else {
        // Ya registrado o error no crítico
        const errMsg = regData.error?.message ?? ''
        if (errMsg.includes('already registered') || errMsg.includes('already')) {
          results.push({ step: 'register_phone', status: 'ok', detail: 'Número ya estaba registrado' })
        } else {
          results.push({ step: 'register_phone', status: 'warning', detail: errMsg || 'No se pudo registrar' })
        }
      }
    } catch (err: any) {
      results.push({ step: 'register_phone', status: 'warning', detail: err.message })
    }

    // ── PASO 5: Guardar todo en Supabase ──
    try {
      const payload: Record<string, unknown> = {
        user_id: userId,
        meta_token,
        phone_number_id,
        whatsapp_number: whatsapp_number?.trim() ?? null,
        webhook_verify_token: webhook_verify_token?.trim() || null,
        active: true,
      }

      const { data: tenant, error: dbErr } = await supabase
        .from('tenants')
        .upsert(payload, { onConflict: 'user_id' })
        .select('id, name')
        .single()

      if (dbErr) throw dbErr

      results.push({ step: 'save_tenant', status: 'ok', detail: `Tenant ${tenant.id} actualizado` })

      // Respuesta final
      const allOk = results.every(r => r.status === 'ok' || r.status === 'warning')
      return res.json({
        ok: allOk,
        connected: allOk,
        tenant_id: tenant.id,
        waba_id: wabaId,
        webhook_url: 'https://nexbot.pro/api/whatsapp/webhook',
        results,
      })
    } catch (err: any) {
      return res.status(500).json({ error: `Error al guardar en BD: ${err.message}`, step: 'save_tenant', results })
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message, results })
  }
})

export default router
