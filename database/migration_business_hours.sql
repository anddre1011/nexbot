-- Agregar columna business_hours a tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT NULL;

-- Ejemplo de valor:
-- {
--   "lunes":     { "start": "06:00", "end": "23:00", "enabled": true },
--   "martes":    { "start": "06:00", "end": "23:00", "enabled": true },
--   "miercoles": { "start": "06:00", "end": "23:00", "enabled": true },
--   "jueves":    { "start": "06:00", "end": "23:00", "enabled": true },
--   "viernes":   { "start": "06:00", "end": "23:00", "enabled": true },
--   "sabado":    { "start": "08:00", "end": "20:00", "enabled": true },
--   "domingo":   { "start": "08:00", "end": "20:00", "enabled": false }
-- }
