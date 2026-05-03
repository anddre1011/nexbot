-- Migración 004 — campos extra en contacts + RPC enriquecida
alter table public.contacts
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists tags       text[]  not null default '{}';

create index if not exists idx_contacts_ai on public.contacts(tenant_id, ai_enabled);

-- Devuelve contactos con campaña, valor de ventas y estado Kanban
create or replace function public.get_contacts_list(
  p_tenant_id    uuid,
  p_status       text    default null,
  p_campaign_id  uuid    default null,
  p_kanban       text    default null,
  p_search       text    default null
)
returns table (
  id              uuid,
  phone           text,
  name            text,
  status          text,
  ai_enabled      boolean,
  tags            text[],
  last_message_at timestamptz,
  created_at      timestamptz,
  campaign_id     uuid,
  campaign_name   text,
  kanban_status   text,
  total_value     numeric
) language sql stable security definer as $$
  select
    ct.id,
    ct.phone,
    ct.name,
    ct.status,
    ct.ai_enabled,
    ct.tags,
    ct.last_message_at,
    ct.created_at,
    conv.campaign_id,
    camp.name               as campaign_name,
    conv.conv_status        as kanban_status,
    coalesce(s.total, 0)    as total_value
  from public.contacts ct
  left join lateral (
    select c.campaign_id, c.status as conv_status
    from public.conversations c
    where c.contact_id = ct.id and c.tenant_id = p_tenant_id
    order by c.created_at desc limit 1
  ) conv on true
  left join public.campaigns camp on camp.id = conv.campaign_id
  left join lateral (
    select sum(amount) as total
    from public.sales
    where contact_id = ct.id
      and tenant_id  = p_tenant_id
      and status     = 'confirmed'
  ) s on true
  where ct.tenant_id = p_tenant_id
    and (p_status      is null or ct.status          = p_status)
    and (p_campaign_id is null or conv.campaign_id   = p_campaign_id)
    and (p_kanban      is null or conv.conv_status   = p_kanban)
    and (p_search      is null or ct.name  ilike '%' || p_search || '%'
                               or ct.phone ilike '%' || p_search || '%')
  order by ct.last_message_at desc nulls last;
$$;
