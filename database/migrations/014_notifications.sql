-- Tabla de notificaciones (in-app y push)
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL, -- 'sale' | 'disqualification' | 'low_credits' | 'new_contact'
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  data          JSONB DEFAULT '{}',
  read          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_read ON notifications(tenant_id, read, created_at DESC);

-- Tabla de suscripciones push (Web Push API)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  subscription  JSONB NOT NULL, -- { endpoint, keys: { p256dh, auth } }
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, (subscription->>'endpoint'))
);

-- Preferencias de notificaciones por tenant
CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE PRIMARY KEY,
  sales               BOOLEAN DEFAULT TRUE,
  disqualifications   BOOLEAN DEFAULT TRUE,
  low_credits         BOOLEAN DEFAULT TRUE,
  new_contacts        BOOLEAN DEFAULT FALSE,
  push_enabled        BOOLEAN DEFAULT FALSE,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_notifications"    ON notifications            FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()));
CREATE POLICY "tenant_push_subs"        ON push_subscriptions       FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()));
CREATE POLICY "tenant_notif_prefs"      ON notification_preferences FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()));
