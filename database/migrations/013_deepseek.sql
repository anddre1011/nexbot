-- Migración 013 — Soporte DeepSeek API
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS deepseek_key text;

-- Ampliar CHECK de modelo en flows para incluir DeepSeek
ALTER TABLE public.flows DROP CONSTRAINT IF EXISTS flows_model_check;
ALTER TABLE public.flows ADD CONSTRAINT flows_model_check
  CHECK (model IN ('gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo', 'deepseek-chat', 'deepseek-reasoner'));
