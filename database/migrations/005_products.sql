-- Migración 005 — tabla products con upsell/downsell/folders
create table public.products (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  folder       text not null default 'General',
  name         text not null,
  type         text not null default 'digital'
                 check (type in ('infoproduct', 'digital', 'physical', 'other')),
  price        numeric(12, 2) not null check (price >= 0),
  description  text,
  delivery_url text,
  upsell_id    uuid references public.products(id) on delete set null,
  downsell_id  uuid references public.products(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index idx_products_tenant_id on public.products(tenant_id);
create index idx_products_folder    on public.products(tenant_id, folder);

alter table public.products enable row level security;

create policy "products: own tenant" on public.products
  for all using (tenant_id in (select auth.tenant_ids()));
