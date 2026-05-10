import webpush from 'web-push'
import { supabase } from './supabase'

const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY  || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
const vapidEmail      = process.env.VAPID_EMAIL       || 'admin@nexbot.pro'

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey)
}

export type NotifType = 'sale' | 'disqualification' | 'low_credits' | 'new_contact'

export async function createNotification(opts: {
  tenantId: string; type: NotifType; title: string; body: string; data?: Record<string, unknown>
}) {
  const { tenantId, type, title, body, data = {} } = opts

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const prefMap: Record<NotifType, boolean> = {
    sale:             prefs?.sales             ?? true,
    disqualification: prefs?.disqualifications ?? true,
    low_credits:      prefs?.low_credits       ?? true,
    new_contact:      prefs?.new_contacts      ?? false,
  }

  if (!prefMap[type]) return

  const { data: notif } = await supabase
    .from('notifications')
    .insert({ tenant_id: tenantId, type, title, body, data })
    .select('id')
    .single()

  console.log(`[notif] ${type} → ${title}`)

  if (prefs?.push_enabled && vapidPublicKey) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('tenant_id', tenantId)

    if (subs?.length) {
      const payload = JSON.stringify({ title, body, icon: '/icon.svg', badge: '/icon.svg', data: { ...data, notifId: notif?.id } })
      await Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription as webpush.PushSubscription, payload)))
    }
  }
}
