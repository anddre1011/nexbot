import { Router } from 'express'
import { requireAuth } from '../middlewares/auth'
import { supabase } from '../services/supabase'
import { queueConversion, sendConversion } from '../services/capi.service'

const router = Router()

router.use(requireAuth)

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .single()
  return data?.id ?? null
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

router.get('/', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const page = Math.max(1, Math.floor(asNumber(req.query.page, 1)))
  const limit = Math.min(100, Math.max(1, Math.floor(asNumber(req.query.limit, 50))))
  const fromIdx = (page - 1) * limit
  const toIdx = fromIdx + limit - 1

  let query = supabase
    .from('conversions')
    .select('*, contacts(name, phone)', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(fromIdx, toIdx)

  const { from, to, status, event_name } = req.query
  if (from) query = query.gte('created_at', String(from))
  if (to) query = query.lte('created_at', String(to))
  if (status) query = query.eq('status', String(status))
  if (event_name) query = query.eq('event_name', String(event_name))

  const { data, error, count } = await query
  if (error) { res.status(500).json({ error: error.message }); return }

  res.json({ data: data ?? [], page, limit, total: count ?? 0 })
})

router.get('/stats', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  let query = supabase
    .from('conversions')
    .select('status, value, ctwa_clid, event_name, created_at')
    .eq('tenant_id', tenantId)

  const { from, to, status, event_name } = req.query
  if (from) query = query.gte('created_at', String(from))
  if (to) query = query.lte('created_at', String(to))
  if (status) query = query.eq('status', String(status))
  if (event_name) query = query.eq('event_name', String(event_name))

  const { data, error } = await query

  if (error) { res.status(500).json({ error: error.message }); return }

  const rows = data ?? []
  const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.status ?? 'unknown')
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const sentValue = rows
    .filter((row) => row.status === 'sent')
    .reduce((sum, row) => sum + Number(row.value ?? 0), 0)
  const attributed = rows.filter((row) => Boolean(row.ctwa_clid)).length

  res.json({
    total: rows.length,
    by_status: byStatus,
    sent_value: sentValue,
    attribution_rate: rows.length ? Math.round((attributed / rows.length) * 1000) / 10 : 0,
    sent: byStatus.sent ?? 0,
    pending: (byStatus.pending ?? 0) + (byStatus.retrying ?? 0) + (byStatus.sending ?? 0),
    failed: byStatus.failed ?? 0,
    no_attribution: byStatus.no_attribution ?? 0,
  })
})

router.post('/:id/retry', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { data: conversion, error: findError } = await supabase
    .from('conversions')
    .select('id')
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .single()

  if (findError || !conversion) { res.status(404).json({ error: 'Conversion not found' }); return }

  const { error } = await supabase
    .from('conversions')
    .update({ attempts: 0, next_retry_at: null, status: 'pending' })
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)

  if (error) { res.status(500).json({ error: error.message }); return }

  const ok = await sendConversion(req.params.id)
  res.json({ ok })
})

router.post('/manual', async (req, res) => {
  const tenantId = await getTenantId(res.locals.user.id)
  if (!tenantId) { res.status(404).json({ error: 'Tenant not found' }); return }

  const { contact_id, value, currency, event_name, product_names, notes } = req.body ?? {}
  if (!contact_id) { res.status(400).json({ error: 'contact_id is required' }); return }

  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: 'value must be a valid number' })
    return
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', String(contact_id))
    .eq('tenant_id', tenantId)
    .single()

  if (contactError || !contact) { res.status(404).json({ error: 'Contact not found' }); return }

  const id = await queueConversion({
    tenantId,
    contactId: String(contact_id),
    eventName: event_name || 'Purchase',
    value: amount,
    currency: currency || 'BOB',
    productNames: Array.isArray(product_names) ? product_names.map(String) : undefined,
    markedVia: 'manual',
    markedByUserId: res.locals.user.id,
    notes: notes ? String(notes) : null,
  })

  if (!id) { res.status(500).json({ error: 'Could not queue conversion' }); return }
  res.json({ ok: true, id })
})

export default router
