create table if not exists public.scheduled_inactivity_jobs (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  flow_id         uuid references public.flows(id) on delete set null,
  rule_id         uuid references public.flow_inactivity_rules(id) on delete set null,
  contact_phone   text not null,
  kind            text not null check (kind in ('text', 'image', 'video', 'media_var', 'close')),
  content         text,
  media_url       text,
  due_at          timestamptz not null,
  status          text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'canceled')),
  attempts        integer not null default 0,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_sched_inact_due
  on public.scheduled_inactivity_jobs(status, due_at);

create index if not exists idx_sched_inact_conversation
  on public.scheduled_inactivity_jobs(conversation_id, status);

create index if not exists idx_sched_inact_tenant
  on public.scheduled_inactivity_jobs(tenant_id, status, due_at);

alter table public.scheduled_inactivity_jobs enable row level security;

drop policy if exists "scheduled_inactivity_jobs: own tenant" on public.scheduled_inactivity_jobs;
create policy "scheduled_inactivity_jobs: own tenant" on public.scheduled_inactivity_jobs
  for all using (tenant_id in (select auth.tenant_ids()));

notify pgrst, 'reload schema';
