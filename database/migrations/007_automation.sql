-- Migración 007 — automatización: campañas, palabras clave, secuencias

create table public.automation_campaigns (
  id                uuid primary key default uuid_generate_v4(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  flow_id           uuid references public.flows(id) on delete set null,
  name              text not null,
  meta_ad_source_id text,
  executions        integer not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.keywords (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  flow_id     uuid references public.flows(id) on delete set null,
  keyword     text not null,
  executions  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, keyword)
);

create table public.sequences (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  -- [{delay_minutes: number, content: string}]
  messages    jsonb not null default '[]',
  executions  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index idx_automation_campaigns_tenant on public.automation_campaigns(tenant_id);
create index idx_keywords_tenant             on public.keywords(tenant_id);
create index idx_sequences_tenant            on public.sequences(tenant_id);

alter table public.automation_campaigns enable row level security;
alter table public.keywords             enable row level security;
alter table public.sequences            enable row level security;

create policy "automation_campaigns: own tenant" on public.automation_campaigns
  for all using (tenant_id in (select auth.tenant_ids()));
create policy "keywords: own tenant" on public.keywords
  for all using (tenant_id in (select auth.tenant_ids()));
create policy "sequences: own tenant" on public.sequences
  for all using (tenant_id in (select auth.tenant_ids()));
