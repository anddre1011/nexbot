-- Migración 011 — ampliar tabla flows para Constructor IA

-- Ampliar CHECK de modelo para incluir gpt-3.5-turbo
alter table public.flows drop constraint if exists flows_model_check;
alter table public.flows add constraint flows_model_check
  check (model in ('gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo'));

-- Campos de conversión y etiquetas
alter table public.flows
  add column if not exists conversion_enabled     boolean not null default false,
  add column if not exists conversion_message     text,
  add column if not exists conversion_product_id  uuid references public.products(id) on delete set null,
  add column if not exists tags                   text[] not null default '{}';
