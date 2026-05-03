-- Migración 008 — campos Meta Ads Marketing API en tenants
alter table public.tenants
  add column if not exists meta_ads_token      text,
  add column if not exists meta_ads_account_id text;
