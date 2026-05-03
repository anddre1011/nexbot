-- Migración 002 — soporte para lista de conversaciones con preview
-- Ejecutar después de schema.sql y 001_tenant_settings.sql

alter table public.conversations
  add column if not exists last_read_at timestamptz;

-- Devuelve lista de conversaciones con último mensaje y contador de no leídos.
-- Usar con supabase.rpc('get_conversation_list', { p_tenant_id: '...' })
create or replace function public.get_conversation_list(p_tenant_id uuid)
returns table (
  id               uuid,
  status           text,
  campaign_id      uuid,
  created_at       timestamptz,
  contact_id       uuid,
  contact_phone    text,
  contact_name     text,
  last_message     text,
  last_direction   text,
  last_message_at  timestamptz,
  unread_count     bigint
) language sql stable security definer as $$
  select
    c.id,
    c.status,
    c.campaign_id,
    c.created_at,
    ct.id                                         as contact_id,
    ct.phone                                      as contact_phone,
    ct.name                                       as contact_name,
    m.content                                     as last_message,
    m.direction                                   as last_direction,
    m.created_at                                  as last_message_at,
    (
      select count(*)
      from public.messages ms
      where ms.conversation_id = c.id
        and ms.direction = 'inbound'
        and ms.created_at > coalesce(c.last_read_at, '1970-01-01'::timestamptz)
    )                                             as unread_count
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  left join lateral (
    select content, direction, created_at
    from public.messages
    where conversation_id = c.id
    order by created_at desc
    limit 1
  ) m on true
  where c.tenant_id = p_tenant_id
  order by coalesce(m.created_at, c.created_at) desc;
$$;
