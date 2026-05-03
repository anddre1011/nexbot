-- ═══════════════════════════════════════════════════════════════════
-- NexBot — Schema completo Supabase
-- Ejecutar en SQL Editor de Supabase (Settings → SQL Editor)
-- Orden: extensiones → tablas → índices → RLS → funciones
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- EXTENSIONES
-- ─────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────
-- USERS
-- Extiende auth.users de Supabase con perfil propio.
-- ─────────────────────────────────────────
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- TENANTS
-- Un tenant = un negocio con su propio número de WhatsApp.
-- phone_number_id viene de Meta (Settings → WhatsApp → Phone number ID)
-- y permite enrutar webhooks en instancias multi-tenant.
-- ─────────────────────────────────────────
create table public.tenants (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.users(id) on delete cascade,
  name                text not null,
  whatsapp_number     text not null unique,
  phone_number_id     text unique,                    -- Meta phone number ID
  openai_key          text,                           -- encriptada en app antes de guardar
  system_prompt       text,                           -- prompt base del agente IA
  plan                text not null default 'free'
                        check (plan in ('free', 'starter', 'pro', 'enterprise')),
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create index idx_tenants_user_id        on public.tenants(user_id);
create index idx_tenants_phone_number   on public.tenants(phone_number_id);

-- ─────────────────────────────────────────
-- CAMPAIGNS
-- Auto-creadas desde referral.ad_id del webhook de Meta.
-- meta_source = URL del anuncio, meta_headline = título.
-- ─────────────────────────────────────────
create table public.campaigns (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  meta_ad_id    text,
  meta_source   text,
  meta_headline text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, meta_ad_id)                      -- evita duplicar por el mismo ad_id
);

create index idx_campaigns_tenant_id on public.campaigns(tenant_id);
create index idx_campaigns_meta_ad   on public.campaigns(meta_ad_id);

-- ─────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────
create table public.contacts (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  phone            text not null,
  name             text,
  status           text not null default 'active'
                     check (status in ('active', 'blocked', 'unsubscribed')),
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (tenant_id, phone)
);

create index idx_contacts_tenant_id  on public.contacts(tenant_id);
create index idx_contacts_phone      on public.contacts(phone);
create index idx_contacts_last_msg   on public.contacts(last_message_at desc);
create index idx_contacts_status     on public.contacts(tenant_id, status);

-- ─────────────────────────────────────────
-- CONVERSATIONS
-- campaign_id se asigna desde el primer referral del mensaje entrante.
-- ─────────────────────────────────────────
create table public.conversations (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  status       text not null default 'bot'
                 check (status in ('open', 'closed', 'bot', 'human')),
  campaign_id  uuid references public.campaigns(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index idx_conversations_tenant_id   on public.conversations(tenant_id);
create index idx_conversations_contact_id  on public.conversations(contact_id);
create index idx_conversations_status      on public.conversations(tenant_id, status);
create index idx_conversations_campaign_id on public.conversations(campaign_id);
create index idx_conversations_created_at  on public.conversations(tenant_id, created_at desc);

-- ─────────────────────────────────────────
-- MESSAGES
-- ─────────────────────────────────────────
create table public.messages (
  id               uuid primary key default uuid_generate_v4(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  direction        text not null check (direction in ('inbound', 'outbound')),
  type             text not null default 'text'
                     check (type in ('text', 'image', 'audio', 'document', 'template')),
  content          text,
  created_at       timestamptz not null default now()
);

create index idx_messages_conversation_id on public.messages(conversation_id);
create index idx_messages_created_at      on public.messages(conversation_id, created_at desc);

-- ─────────────────────────────────────────
-- SALES
-- campaign_id se propaga desde la conversación al confirmar pago.
-- ─────────────────────────────────────────
create table public.sales (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  product      text not null,
  amount       numeric(12, 2) not null check (amount >= 0),
  status       text not null default 'pending'
                 check (status in ('pending', 'confirmed', 'rejected')),
  campaign_id  uuid references public.campaigns(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index idx_sales_tenant_id    on public.sales(tenant_id);
create index idx_sales_contact_id   on public.sales(contact_id);
create index idx_sales_status       on public.sales(tenant_id, status);
create index idx_sales_campaign_id  on public.sales(campaign_id);
create index idx_sales_created_at   on public.sales(tenant_id, created_at desc);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Cada tenant solo accede a sus propios datos.
-- ─────────────────────────────────────────
alter table public.users          enable row level security;
alter table public.tenants        enable row level security;
alter table public.campaigns      enable row level security;
alter table public.contacts       enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.sales          enable row level security;

-- Helper: tenant IDs del usuario autenticado
create or replace function auth.tenant_ids()
returns setof uuid language sql stable security definer as $$
  select id from public.tenants where user_id = auth.uid()
$$;

-- users: solo propio registro
create policy "users: own row" on public.users
  for all using (id = auth.uid());

-- tenants: solo los del usuario autenticado
create policy "tenants: own" on public.tenants
  for all using (user_id = auth.uid());

-- campaigns
create policy "campaigns: own tenant" on public.campaigns
  for all using (tenant_id in (select auth.tenant_ids()));

-- contacts
create policy "contacts: own tenant" on public.contacts
  for all using (tenant_id in (select auth.tenant_ids()));

-- conversations
create policy "conversations: own tenant" on public.conversations
  for all using (tenant_id in (select auth.tenant_ids()));

-- messages: acceso a través de la conversación del tenant
create policy "messages: own tenant" on public.messages
  for all using (
    conversation_id in (
      select id from public.conversations
      where tenant_id in (select auth.tenant_ids())
    )
  );

-- sales
create policy "sales: own tenant" on public.sales
  for all using (tenant_id in (select auth.tenant_ids()));

-- ─────────────────────────────────────────
-- ANALYTICS HELPERS (funciones RPC opcionales)
-- Llamar con supabase.rpc('sales_today', { p_tenant_id: '...' })
-- ─────────────────────────────────────────
create or replace function public.sales_today(p_tenant_id uuid)
returns table (
  confirmed_count bigint,
  total_revenue   numeric,
  conversion_rate numeric
) language sql stable security definer as $$
  with all_sales as (
    select status, amount
    from public.sales
    where tenant_id = p_tenant_id
      and created_at >= current_date
  )
  select
    count(*) filter (where status = 'confirmed')                           as confirmed_count,
    coalesce(sum(amount) filter (where status = 'confirmed'), 0)           as total_revenue,
    case when count(*) > 0
      then round(count(*) filter (where status = 'confirmed')::numeric / count(*) * 100, 1)
      else 0
    end                                                                    as conversion_rate
  from all_sales;
$$;

create or replace function public.campaign_stats(p_tenant_id uuid)
returns table (
  campaign_id   uuid,
  campaign_name text,
  meta_ad_id    text,
  sales_count   bigint,
  total_revenue numeric
) language sql stable security definer as $$
  select
    c.id,
    c.name,
    c.meta_ad_id,
    count(s.id)               as sales_count,
    coalesce(sum(s.amount), 0) as total_revenue
  from public.campaigns c
  left join public.sales s
    on s.campaign_id = c.id and s.status = 'confirmed'
  where c.tenant_id = p_tenant_id
  group by c.id, c.name, c.meta_ad_id
  order by total_revenue desc;
$$;
