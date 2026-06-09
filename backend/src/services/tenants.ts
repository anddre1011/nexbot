import { supabase } from './supabase'

type AuthUserLike = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}

export async function getTenantIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') throw error
  return data?.id ?? null
}

export async function ensureTenantForUser(user: AuthUserLike): Promise<string> {
  const existing = await getTenantIdForUser(user.id)
  if (existing) return existing

  const { data: anyTenant, error: anyTenantError } = await supabase
    .from('tenants')
    .select('id, active')
    .eq('user_id', user.id)
    .maybeSingle()

  if (anyTenantError && anyTenantError.code !== 'PGRST116') throw anyTenantError
  if (anyTenant?.id) {
    if (!anyTenant.active) {
      await supabase.from('tenants').update({ active: true }).eq('id', anyTenant.id)
    }
    return anyTenant.id
  }

  const email = user.email ?? `${user.id}@nexbot.local`
  const businessName =
    stringValue(user.user_metadata?.full_name) ||
    stringValue(user.user_metadata?.name) ||
    email.split('@')[0] ||
    'Mi Negocio'

  const { error: userError } = await supabase
    .from('users')
    .upsert({ id: user.id, email }, { onConflict: 'id' })

  if (userError) throw userError

  const placeholderPhone = `pending-${user.id}`
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      user_id: user.id,
      name: businessName,
      whatsapp_number: placeholderPhone,
      active: true,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
