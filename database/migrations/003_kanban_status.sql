-- Migración 003 — estados Kanban extendidos + función de consulta
-- Ejecutar después de 001 y 002

-- Ampliar CHECK constraint de conversations.status
alter table public.conversations
  drop constraint if exists conversations_status_check;

alter table public.conversations
  add constraint conversations_status_check
  check (status in ('open', 'closed', 'bot', 'human', 'attending', 'converted', 'disqualified', 'abandoned'));

-- Función para el tablero Kanban con datos enriquecidos
create or replace function public.get_kanban_conversations(
  p_tenant_id uuid,
  p_date_from timestamptz default null
)
returns table (
  id              uuid,
  status          text,
  contact_id      uuid,
  contact_phone   text,
  contact_name    text,
  campaign_name   text,
  campaign_id     uuid,
  last_message_at timestamptz,
  sale_amount     numeric,
  created_at      timestamptz
) language sql stable security definer as $$
  select
    c.id,
    c.status,
    ct.id                   as contact_id,
    ct.phone                as contact_phone,
    ct.name                 as contact_name,
    camp.name               as campaign_name,
    c.campaign_id,
    ct.last_message_at,
    s.amount                as sale_amount,
    c.created_at
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  left join public.campaigns camp on camp.id = c.campaign_id
  left join lateral (
    select amount
    from public.sales
    where contact_id = ct.id
      and tenant_id  = p_tenant_id
      and status     = 'confirmed'
    order by created_at desc
    limit 1
  ) s on true
  where c.tenant_id = p_tenant_id
    and c.status in ('human', 'attending', 'converted', 'disqualified', 'abandoned')
    and (p_date_from is null or c.created_at >= p_date_from)
  order by coalesce(ct.last_message_at, c.created_at) desc;
$$;
