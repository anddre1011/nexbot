-- =====================================================================
-- Migration: NexBot foundation for CAPI, Ads, flows and Meta settings
-- Version: 1.0
-- Date: 2026-05-27
--
-- Additive migration. It preserves the current working NexBot schema and
-- only adds the Tech Provider/CAPI foundation required by the master doc.
-- =====================================================================

create extension if not exists "uuid-ossp";

-- Helper used by RLS policies. Some older migrations assumed this exists.
create or replace function auth.tenant_ids()
returns setof uuid language sql stable security definer as $$
  select id from public.tenants where user_id = auth.uid()
$$;

-- =====================================================================
-- Section 1: Meta configuration per tenant
-- =====================================================================

create table if not exists public.tenant_meta_settings (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,

  -- WhatsApp Business API
  waba_id text,
  phone_number_id text,
  whatsapp_token_encrypted text,
  whatsapp_verify_token text,
  whatsapp_business_name text,
  whatsapp_display_phone_number text,
  whatsapp_connected_at timestamptz,
  whatsapp_status text not null default 'disconnected'
    check (whatsapp_status in ('connected', 'disconnected', 'error', 'expired')),

  -- Conversions API (CAPI)
  capi_dataset_id text,
  capi_token_encrypted text,
  capi_test_event_code text,
  capi_status text not null default 'inactive'
    check (capi_status in ('active', 'inactive', 'error')),
  capi_last_event_sent_at timestamptz,

  -- Facebook Ads (Marketing API)
  ads_ad_account_id text,
  ads_token_encrypted text,
  ads_token_expires_at timestamptz,
  ads_status text not null default 'disconnected'
    check (ads_status in ('connected', 'disconnected', 'error', 'expired')),
  ads_connected_at timestamptz,
  ads_last_sync_at timestamptz,

  -- Meta Business ID
  meta_business_id text,

  -- Metadata
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_meta_settings_tenant
  on public.tenant_meta_settings(tenant_id);

create index if not exists idx_tenant_meta_settings_phone
  on public.tenant_meta_settings(phone_number_id)
  where phone_number_id is not null;

-- =====================================================================
-- Section 2: CTWA attribution on existing contacts
-- =====================================================================

alter table public.contacts
  add column if not exists ctwa_clid text,
  add column if not exists ctwa_clid_captured_at timestamptz,
  add column if not exists ctwa_source_id text,
  add column if not exists ctwa_source_url text,
  add column if not exists ctwa_source_type text,
  add column if not exists ctwa_header_text text,
  add column if not exists ctwa_body_text text;

create index if not exists idx_contacts_ctwa_clid
  on public.contacts(ctwa_clid)
  where ctwa_clid is not null;

-- =====================================================================
-- Section 3: Conversions and CAPI
-- =====================================================================

create table if not exists public.conversions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid,

  event_name text not null default 'Purchase'
    check (event_name in ('Purchase', 'Lead', 'CompleteRegistration', 'AddToCart', 'InitiateCheckout', 'Subscribe', 'Contact')),
  event_time timestamptz not null default now(),

  value numeric(12, 2),
  currency text not null default 'BOB'
    check (currency in ('BOB', 'USD', 'EUR', 'ARS', 'BRL', 'CLP', 'COP', 'PEN', 'MXN')),

  -- Idempotency for Meta CAPI.
  event_id uuid not null unique default uuid_generate_v4(),

  ctwa_clid text,
  ctwa_clid_age_hours integer,
  has_attribution boolean generated always as (ctwa_clid is not null) stored,

  product_ids text[],
  product_names text[],
  num_items integer,
  order_id text,

  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'retrying', 'no_attribution', 'cancelled')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,

  meta_response jsonb,
  meta_event_received_id text,
  meta_fbtrace_id text,

  marked_by_user_id uuid references public.users(id),
  marked_via text not null default 'manual'
    check (marked_via in ('manual', 'api', 'flow', 'auto')),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_conversions_status
  on public.conversions(status)
  where status in ('pending', 'retrying');

create index if not exists idx_conversions_tenant
  on public.conversions(tenant_id);

create index if not exists idx_conversions_contact
  on public.conversions(contact_id);

create index if not exists idx_conversions_ctwa
  on public.conversions(ctwa_clid)
  where ctwa_clid is not null;

create index if not exists idx_conversions_created
  on public.conversions(tenant_id, created_at desc);

-- =====================================================================
-- Section 4: Flow templates and executions
-- =====================================================================

create table if not exists public.flow_templates (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  name text not null,
  description text,
  category text not null default 'custom'
    check (category in ('bienvenida', 'ventas', 'post_venta', 'soporte', 'recuperacion', 'recordatorio', 'custom')),

  icon text not null default 'bolt',
  color text not null default '#3B82F6',

  is_active boolean not null default true,
  is_default boolean not null default false,
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'first_message', 'keyword', 'no_response')),
  trigger_config jsonb,

  total_steps integer not null default 0,
  times_sent integer not null default 0,
  last_sent_at timestamptz,

  created_by_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_flow_templates_tenant
  on public.flow_templates(tenant_id)
  where is_active = true;

create index if not exists idx_flow_templates_trigger
  on public.flow_templates(tenant_id, trigger_type)
  where is_active = true;

-- The project already has public.flow_steps for current working flows.
-- To avoid breaking production flows, this migration extends that table
-- with the template-step fields required by the master architecture.
alter table public.flow_steps
  add column if not exists flow_template_id uuid references public.flow_templates(id) on delete cascade,
  add column if not exists step_order integer,
  add column if not exists message_type text
    check (message_type in ('text', 'image', 'video', 'audio', 'document', 'template', 'interactive_buttons', 'interactive_list', 'location')),
  add column if not exists text_content text,
  add column if not exists media_storage_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_caption text,
  add column if not exists document_filename text,
  add column if not exists template_name text,
  add column if not exists template_language text default 'es',
  add column if not exists template_variables jsonb,
  add column if not exists interactive_buttons jsonb,
  add column if not exists interactive_list_button_text text,
  add column if not exists interactive_list_sections jsonb,
  add column if not exists location_lat numeric(10, 7),
  add column if not exists location_lng numeric(10, 7),
  add column if not exists location_name text,
  add column if not exists location_address text,
  add column if not exists delay_seconds integer default 2
    check (delay_seconds >= 0 and delay_seconds <= 3600),
  add column if not exists use_variables boolean not null default false,
  add column if not exists condition_type text,
  add column if not exists condition_value text;

create index if not exists idx_flow_steps_template
  on public.flow_steps(flow_template_id, step_order)
  where flow_template_id is not null;

create unique index if not exists uq_flow_steps_template_order
  on public.flow_steps(flow_template_id, step_order)
  where flow_template_id is not null and step_order is not null;

create table if not exists public.flow_executions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flow_template_id uuid references public.flow_templates(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid,
  triggered_by_user_id uuid references public.users(id),
  triggered_by_type text not null default 'manual',

  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  current_step integer not null default 0,
  total_steps integer,

  steps_completed integer not null default 0,
  steps_failed integer not null default 0,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,

  error_message text,
  error_step_id uuid
);

create index if not exists idx_flow_executions_status
  on public.flow_executions(status)
  where status in ('pending', 'in_progress');

create index if not exists idx_flow_executions_tenant
  on public.flow_executions(tenant_id);

create index if not exists idx_flow_executions_contact
  on public.flow_executions(contact_id);

-- =====================================================================
-- Section 5: Facebook Ads campaigns cache
-- =====================================================================

create table if not exists public.campaigns_cache (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  campaign_id text not null,
  ad_account_id text,

  campaign_name text,
  objective text,
  status text,
  effective_status text,
  buying_type text,

  daily_budget numeric(12, 2),
  lifetime_budget numeric(12, 2),
  bid_strategy text,

  start_time timestamptz,
  stop_time timestamptz,

  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  spend numeric(12, 2) not null default 0,
  cpm numeric(12, 4) not null default 0,
  cpc numeric(12, 4) not null default 0,
  ctr numeric(8, 4) not null default 0,

  conversations_count integer not null default 0,
  sales_count integer not null default 0,
  sales_value numeric(12, 2) not null default 0,
  cpa numeric(12, 2) not null default 0,
  roas numeric(8, 4) not null default 0,

  last_synced_at timestamptz not null default now(),
  sync_status text not null default 'ok',
  sync_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(tenant_id, campaign_id)
);

create index if not exists idx_campaigns_cache_tenant
  on public.campaigns_cache(tenant_id);

create index if not exists idx_campaigns_cache_status
  on public.campaigns_cache(tenant_id, status);

create index if not exists idx_campaigns_cache_synced
  on public.campaigns_cache(last_synced_at);

-- =====================================================================
-- Section 6: Meta event log / audit trail
-- =====================================================================

create table if not exists public.meta_events_log (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  event_type text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),

  endpoint text,
  http_method text,
  status_code integer,

  request_payload jsonb,
  response_payload jsonb,

  duration_ms integer,

  is_error boolean not null default false,
  error_message text,

  created_at timestamptz not null default now()
);

create index if not exists idx_meta_events_tenant
  on public.meta_events_log(tenant_id, created_at desc);

create index if not exists idx_meta_events_type
  on public.meta_events_log(tenant_id, event_type, created_at desc);

create index if not exists idx_meta_events_errors
  on public.meta_events_log(tenant_id, created_at desc)
  where is_error = true;

-- =====================================================================
-- Section 7: Triggers and functions
-- =====================================================================

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_tenant_meta_settings_updated_at on public.tenant_meta_settings;
create trigger update_tenant_meta_settings_updated_at
  before update on public.tenant_meta_settings
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_conversions_updated_at on public.conversions;
create trigger update_conversions_updated_at
  before update on public.conversions
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_flow_templates_updated_at on public.flow_templates;
create trigger update_flow_templates_updated_at
  before update on public.flow_templates
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_campaigns_cache_updated_at on public.campaigns_cache;
create trigger update_campaigns_cache_updated_at
  before update on public.campaigns_cache
  for each row execute function public.update_updated_at_column();

create or replace function public.update_flow_template_total_steps()
returns trigger as $$
declare
  target_template_id uuid;
begin
  target_template_id = coalesce(new.flow_template_id, old.flow_template_id);

  if target_template_id is not null then
    update public.flow_templates
    set total_steps = (
      select count(*)
      from public.flow_steps
      where flow_template_id = target_template_id
    )
    where id = target_template_id;
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists update_flow_template_total_steps_trigger on public.flow_steps;
create trigger update_flow_template_total_steps_trigger
  after insert or update or delete on public.flow_steps
  for each row execute function public.update_flow_template_total_steps();

-- =====================================================================
-- Section 8: Row Level Security
-- =====================================================================

alter table public.tenant_meta_settings enable row level security;
alter table public.conversions enable row level security;
alter table public.flow_templates enable row level security;
alter table public.flow_steps enable row level security;
alter table public.flow_executions enable row level security;
alter table public.campaigns_cache enable row level security;
alter table public.meta_events_log enable row level security;

drop policy if exists "tenant_meta_settings: own tenant" on public.tenant_meta_settings;
create policy "tenant_meta_settings: own tenant" on public.tenant_meta_settings
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

drop policy if exists "conversions: own tenant" on public.conversions;
create policy "conversions: own tenant" on public.conversions
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

drop policy if exists "flow_templates: own tenant" on public.flow_templates;
create policy "flow_templates: own tenant" on public.flow_templates
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

drop policy if exists "flow_steps: own tenant" on public.flow_steps;
create policy "flow_steps: own tenant" on public.flow_steps
  for all using (
    flow_id in (
      select id from public.flows where tenant_id in (select auth.tenant_ids())
    )
    or flow_template_id in (
      select id from public.flow_templates where tenant_id in (select auth.tenant_ids())
    )
  )
  with check (
    flow_id in (
      select id from public.flows where tenant_id in (select auth.tenant_ids())
    )
    or flow_template_id in (
      select id from public.flow_templates where tenant_id in (select auth.tenant_ids())
    )
  );

drop policy if exists "flow_executions: own tenant" on public.flow_executions;
create policy "flow_executions: own tenant" on public.flow_executions
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

drop policy if exists "campaigns_cache: own tenant" on public.campaigns_cache;
create policy "campaigns_cache: own tenant" on public.campaigns_cache
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

drop policy if exists "meta_events_log: own tenant" on public.meta_events_log;
create policy "meta_events_log: own tenant" on public.meta_events_log
  for all using (tenant_id in (select auth.tenant_ids()))
  with check (tenant_id in (select auth.tenant_ids()));

notify pgrst, 'reload schema';

-- =====================================================================
-- End of migration
-- =====================================================================
