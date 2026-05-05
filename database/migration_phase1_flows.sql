-- ═══════════════════════════════════════════════════════════════════
-- NexBot — Migration: Phase 1 - Flow Engine
-- Ejecutar en SQL Editor de Supabase (Settings → SQL Editor)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- FLOW_STEPS: Pasos secuenciales del flujo inicial
-- Cada paso = un item en la secuencia (texto, imagen, delay, etc.)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_steps (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id    uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  type       text NOT NULL CHECK (type IN ('text','image','video','audio','file','delay','wait_response')),
  content    text,                       -- texto del mensaje o caption
  media_url  text,                       -- URL del archivo en Supabase Storage
  delay_ms   integer DEFAULT 2000,       -- milisegundos de espera (para type='delay')
  buttons    jsonb DEFAULT '[]'::jsonb,  -- botones interactivos opcionales
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_id ON public.flow_steps(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_steps_position ON public.flow_steps(flow_id, position);

-- ─────────────────────────────────────────
-- FLOW_CONVERSIONS: Flujos de conversión ({{function:conversion}})
-- Se ejecutan cuando la IA detecta un pago válido
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_conversions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id           uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  function_name     text NOT NULL DEFAULT 'conversion',  -- "conversion", "conversion2", etc.
  product_id        uuid REFERENCES public.products(id) ON DELETE SET NULL,
  kanban_stage      text DEFAULT 'converted',            -- etapa kanban destino
  disable_ai        boolean NOT NULL DEFAULT true,       -- desactivar IA tras conversión
  delivery_enabled  boolean NOT NULL DEFAULT true,       -- auto-entregar delivery_url del producto
  confirm_message   text,                                -- "¡Felicidades! Tu pago fue verificado..."
  confirm_steps     jsonb DEFAULT '[]'::jsonb,           -- pasos adicionales post-conversión
  position          integer DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(flow_id, function_name)
);

CREATE INDEX IF NOT EXISTS idx_flow_conversions_flow_id ON public.flow_conversions(flow_id);

-- ─────────────────────────────────────────
-- FLOW_INACTIVITY_RULES: Mensajes de inactividad por flujo
-- Cada regla = un timer que se dispara tras X tiempo sin respuesta
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flow_inactivity_rules (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id    uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  delay_ms   bigint NOT NULL,                    -- ej: 10800000 = 3h, 86400000 = 24h
  type       text NOT NULL CHECK (type IN ('text','image','video','media_var')),
  content    text,                               -- texto o {{media:nombre}}
  media_url  text,                               -- URL directa del media
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_inactivity_flow_id ON public.flow_inactivity_rules(flow_id);

-- ─────────────────────────────────────────
-- MODIFICACIONES A TABLAS EXISTENTES
-- ─────────────────────────────────────────

-- Contacts: agregar kanban_stage y tags
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS kanban_stage text DEFAULT 'nuevo';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_contacts_kanban ON public.contacts(tenant_id, kanban_stage);

-- Conversations: vincular al flujo activo y controlar IA
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS flow_id uuid REFERENCES public.flows(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS flow_step integer DEFAULT 0;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT true;

-- Products: agregar moneda y banner
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS currency text DEFAULT 'BOB';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS banner_url text;

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY para nuevas tablas
-- ─────────────────────────────────────────
ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_inactivity_rules ENABLE ROW LEVEL SECURITY;

-- flow_steps: acceso via flow → tenant
CREATE POLICY "flow_steps: own tenant" ON public.flow_steps
  FOR ALL USING (
    flow_id IN (
      SELECT id FROM public.flows
      WHERE tenant_id IN (SELECT auth.tenant_ids())
    )
  );

-- flow_conversions: acceso via flow → tenant
CREATE POLICY "flow_conversions: own tenant" ON public.flow_conversions
  FOR ALL USING (
    flow_id IN (
      SELECT id FROM public.flows
      WHERE tenant_id IN (SELECT auth.tenant_ids())
    )
  );

-- flow_inactivity_rules: acceso via flow → tenant
CREATE POLICY "flow_inactivity_rules: own tenant" ON public.flow_inactivity_rules
  FOR ALL USING (
    flow_id IN (
      SELECT id FROM public.flows
      WHERE tenant_id IN (SELECT auth.tenant_ids())
    )
  );

-- ─────────────────────────────────────────
-- PUSH SUBSCRIPTIONS (para notificaciones PWA - Fase 6)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  keys       jsonb NOT NULL,             -- {p256dh, auth}
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- Automation campaigns: agregar product_id y source_ids
ALTER TABLE public.automation_campaigns ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.automation_campaigns ADD COLUMN IF NOT EXISTS source_ids text[] DEFAULT '{}';

-- ─────────────────────────────────────────
-- DONE ✅
-- ─────────────────────────────────────────
