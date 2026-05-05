import webpush from 'web-push'
import { supabase } from './supabase'

// Configurar VAPID keys (generar con: npx web-push generate-vapid-keys)
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_EMAIL   = process.env.VAPID_EMAIL       ?? 'mailto:admin@nexbot.pro'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

// ─── Enviar notificación push a un usuario ────────────────────────────────────
export async function sendPushNotification(
  userId: string,
  payload: { title: string; body: string; url?: string }
) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[push] VAPID keys not configured, skipping push notification')
    return
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId)

  if (!subs?.length) return

  const message = JSON.stringify(payload)

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        message
      )
    } catch (err: any) {
      // Si el endpoint ya no es válido, eliminarlo
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', sub.endpoint)
        console.log(`[push] Removed invalid subscription for user ${userId}`)
      } else {
        console.error(`[push] Error sending to ${sub.endpoint}:`, err.message)
      }
    }
  }
}

// ─── Notificar venta nueva a todos los admins del tenant ──────────────────────
export async function notifySale(tenantId: string, amount: number, productName: string) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('user_id')
    .eq('id', tenantId)
    .single()

  if (!tenant?.user_id) return

  await sendPushNotification(tenant.user_id, {
    title: '💰 ¡Nueva venta!',
    body: `${productName} — $${amount.toFixed(2)}`,
    url: '/dashboard',
  })
}

// ─── Notificar tokens bajos ───────────────────────────────────────────────────
export async function notifyLowTokens(tenantId: string, remaining: number) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('user_id')
    .eq('id', tenantId)
    .single()

  if (!tenant?.user_id) return

  await sendPushNotification(tenant.user_id, {
    title: '⚠️ Créditos de IA bajos',
    body: `Te quedan ${remaining} tokens. Recarga para evitar interrupciones.`,
    url: '/configuracion',
  })
}
