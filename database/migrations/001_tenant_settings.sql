-- Migración 001 — campos extra de configuración del tenant
-- Ejecutar en Supabase SQL Editor después del schema.sql base

alter table public.tenants
  add column if not exists meta_token               text,
  add column if not exists webhook_verify_token     text,
  add column if not exists product_name             text,
  add column if not exists product_price            numeric(12, 2),
  add column if not exists payment_methods          text,
  add column if not exists welcome_message          text,
  add column if not exists payment_confirmed_message text;
