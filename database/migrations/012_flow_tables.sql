-- Migración 012 — Tablas de flujos + columnas de productos

-- Products: moneda y banner
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS currency   text NOT NULL DEFAULT 'BOB',
  ADD COLUMN IF NOT EXISTS banner_url text;

-- Pasos del flujo inicial (secuencia de mensajes al primer contacto)
CREATE TABLE IF NOT EXISTS public.flow_steps (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id     uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  type        text NOT NULL CHECK (type IN ('text','image','video','audio','file','delay','wait_response')),
  content     text,
  media_url   text,
  delay_ms    integer NOT NULL DEFAULT 2000,
  buttons     jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_id ON public.flow_steps(flow_id, position);
ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flow_steps: own tenant" ON public.flow_steps
  FOR ALL USING (flow_id IN (SELECT id FROM public.flows WHERE tenant_id IN (SELECT public.tenant_ids())));

-- Funciones de conversión del flujo
CREATE TABLE IF NOT EXISTS public.flow_conversions (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id          uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  function_name    text NOT NULL DEFAULT 'conversion',
  product_id       uuid REFERENCES public.products(id) ON DELETE SET NULL,
  kanban_stage     text NOT NULL DEFAULT 'converted',
  disable_ai       boolean NOT NULL DEFAULT true,
  delivery_enabled boolean NOT NULL DEFAULT true,
  confirm_message  text,
  confirm_steps    jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_conversions_flow_id ON public.flow_conversions(flow_id);
ALTER TABLE public.flow_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flow_conversions: own tenant" ON public.flow_conversions
  FOR ALL USING (flow_id IN (SELECT id FROM public.flows WHERE tenant_id IN (SELECT public.tenant_ids())));

-- Reglas de inactividad del flujo
CREATE TABLE IF NOT EXISTS public.flow_inactivity_rules (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id     uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  delay_ms    integer NOT NULL DEFAULT 10800000,
  type        text NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','video','media_var')),
  content     text,
  media_url   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_inact_flow_id ON public.flow_inactivity_rules(flow_id, position);
ALTER TABLE public.flow_inactivity_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flow_inactivity_rules: own tenant" ON public.flow_inactivity_rules
  FOR ALL USING (flow_id IN (SELECT id FROM public.flows WHERE tenant_id IN (SELECT public.tenant_ids())));
