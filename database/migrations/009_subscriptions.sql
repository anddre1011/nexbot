-- Migración 009 — planes de suscripción multi-tenant

-- Planes (datos fijos del negocio)
create table public.plans (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,
  price_bob       numeric(10, 2) not null,
  max_contacts    integer not null,   -- -1 = ilimitado
  max_flows       integer not null,
  max_campaigns   integer not null,
  max_messages    integer not null,   -- mensajes/mes, -1 = ilimitado
  features        text[]  not null default '{}',
  created_at      timestamptz not null default now()
);

-- Suscripciones de los tenants
create table public.subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  plan_id     uuid not null references public.plans(id),
  status      text not null default 'active'
                check (status in ('active', 'expired', 'cancelled')),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Historial de pagos manuales
create table public.payments (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id         uuid not null references public.plans(id),
  amount_bob      numeric(10, 2) not null,
  method          text not null default 'manual'
                    check (method in ('manual', 'qr', 'transfer', 'card')),
  reference       text,
  status          text not null default 'confirmed'
                    check (status in ('pending', 'confirmed', 'rejected')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index idx_subscriptions_tenant_id on public.subscriptions(tenant_id);
create index idx_subscriptions_status    on public.subscriptions(tenant_id, status);
create index idx_payments_tenant_id      on public.payments(tenant_id);

alter table public.subscriptions enable row level security;
alter table public.payments       enable row level security;

create policy "subscriptions: own tenant" on public.subscriptions
  for all using (tenant_id in (select auth.tenant_ids()));
create policy "payments: own tenant" on public.payments
  for all using (tenant_id in (select auth.tenant_ids()));

-- Planes predefinidos
insert into public.plans (name, price_bob, max_contacts, max_flows, max_campaigns, max_messages, features) values
  ('Básico',     99,  500,   3,   5,   1000, array['Agente IA básico','Validación de comprobantes','Dashboard analíticas','Soporte por email']),
  ('Pro',        199, 2000,  10,  20,  10000, array['Todo en Básico','Constructor IA avanzado','Campañas Meta Ads','Palabras clave ilimitadas','Secuencias automatizadas','Soporte prioritario']),
  ('Enterprise', 399, -1,   -1,  -1,  -1,    array['Todo en Pro','Contactos ilimitados','Flujos ilimitados','API personalizada','Onboarding dedicado','Soporte 24/7']);
