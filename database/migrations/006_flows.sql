-- Migración 006 — tabla de flujos / constructores IA
create table public.flows (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null,
  type                 text not null default 'ai'
                         check (type in ('ai', 'conversational_ai')),
  model                text not null default 'gpt-4o'
                         check (model in ('gpt-4o', 'gpt-4o-mini', 'gpt-4.1')),
  system_prompt        text,
  handoff_agent_name   text,
  -- secuencia de mensajes de bienvenida: [{type, content}]
  welcome_items        jsonb not null default '[]',
  -- mensajes de recuperación por inactividad: [{delay_minutes, message}]
  inactivity_messages  jsonb not null default '[]',
  executions           integer not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

create index idx_flows_tenant_id on public.flows(tenant_id);

alter table public.flows enable row level security;

create policy "flows: own tenant" on public.flows
  for all using (tenant_id in (select auth.tenant_ids()));
