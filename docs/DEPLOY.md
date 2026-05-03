# Guía de despliegue — NexBot en Coolify

## Requisitos previos

- VPS con Docker instalado (mínimo 2 GB RAM, 2 vCPU)
- Coolify instalado en el VPS
- Dominio configurado (ej: `tunexbot.com`)
- Proyecto subido a GitHub/GitLab

---

## 1. Preparar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta los archivos en este orden:
   ```
   database/schema.sql
   database/migrations/001_tenant_settings.sql
   database/migrations/002_conversations_list.sql
   database/migrations/003_kanban_status.sql
   database/migrations/004_contacts_enriched.sql
   database/migrations/005_products.sql
   database/migrations/006_flows.sql
   database/migrations/007_automation.sql
   database/migrations/008_meta_ads.sql
   database/migrations/009_subscriptions.sql
   ```
3. Copia de **Settings → API**:
   - `Project URL` → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
   - `anon / public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY`

---

## 2. Configurar Meta / WhatsApp

1. Ve a [developers.facebook.com](https://developers.facebook.com)
2. Crea una app de tipo **Empresa**
3. Agrega el producto **WhatsApp**
4. En WhatsApp → Configuración copia:
   - `Access Token` → `META_TOKEN`
   - `Phone Number ID` → `META_PHONE_NUMBER_ID`
5. Elige un `META_WEBHOOK_VERIFY_TOKEN` (cualquier cadena secreta)
6. El webhook se configura DESPUÉS del despliegue (necesitas la URL pública)

---

## 3. Subir el proyecto a Coolify

### Opción A: Docker Compose (recomendado)

1. En Coolify → **New Resource → Docker Compose**
2. Conecta tu repositorio GitHub
3. Apunta al archivo `nexbot/docker-compose.yml`
4. En **Environment Variables** agrega todas las variables de `.env.example`
5. En **Domains** configura:
   - `tunexbot.com` → servicio `frontend` (puerto 3000)
   - `api.tunexbot.com` → servicio `backend` (puerto 3001)
6. Haz clic en **Deploy**

### Opción B: servicios separados

Crea 3 recursos en Coolify (uno por servicio), apuntando al repositorio con:
- **frontend**: `Dockerfile` en `nexbot/frontend/Dockerfile`
- **backend**: `Dockerfile` en `nexbot/backend/Dockerfile` con Build Context en `nexbot/`
- **ai-agent**: `Dockerfile` en `nexbot/ai-agent/Dockerfile`

> ⚠️ El backend necesita Build Context apuntando a la carpeta `nexbot/` (no a `nexbot/backend/`) porque importa código de `ai-agent/`.

---

## 4. Variables de entorno en Coolify

Añade estas variables en el panel de Coolify (Environment Variables):

```
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Meta WhatsApp
META_TOKEN=EAA...
META_PHONE_NUMBER_ID=123456789
META_WEBHOOK_VERIFY_TOKEN=tu-token-secreto

# URLs
NEXT_PUBLIC_API_URL=https://api.tunexbot.com

# Tenant (completar después del primer registro)
TENANT_ID=
```

> ⚠️ Las variables `NEXT_PUBLIC_*` deben estar configuradas ANTES del build del frontend. En Coolify, configúralas como Build Args también.

---

## 5. Configurar el webhook en Meta

Una vez desplegado:

1. Ve a Meta for Developers → WhatsApp → **Configuration → Webhook**
2. Callback URL: `https://api.tunexbot.com/api/whatsapp/webhook`
3. Verify Token: el valor de `META_WEBHOOK_VERIFY_TOKEN`
4. Suscripciones requeridas: `messages`, `messaging_postbacks`, `messaging_referrals`
5. Haz clic en **Verify and Save**

---

## 6. Primer registro y tenant

1. Abre `https://tunexbot.com/register`
2. Crea tu cuenta
3. Ve a Supabase → Table Editor → `tenants`
4. Copia el `id` del tenant recién creado
5. En Coolify agrega `TENANT_ID=<id>` y redeploya el backend

---

## 7. Verificar el despliegue

```bash
# Frontend
curl https://tunexbot.com

# Backend health
curl https://api.tunexbot.com/health

# AI Agent health
curl https://tunexbot.com:3002/health   # o según tu configuración de dominios
```

---

## Estructura de servicios

```
tunexbot.com          → frontend (Next.js, puerto 3000)
api.tunexbot.com      → backend  (Express, puerto 3001)
agent.tunexbot.com    → ai-agent (Express, puerto 3002)  [opcional: exponer público]
```

---

## Solución de problemas frecuentes

| Error | Causa | Solución |
|-------|-------|----------|
| Frontend no carga datos | `NEXT_PUBLIC_API_URL` incorrecto | Verificar la URL del backend y rebuild |
| Webhook no verifica | Token incorrecto | Asegúrate de que `META_WEBHOOK_VERIFY_TOKEN` coincide en Meta y en `.env` |
| Backend no conecta Supabase | `SUPABASE_SERVICE_KEY` mal copiada | Copiar la key completa sin espacios |
| Build falla en backend | Build context incorrecto | El contexto debe ser `nexbot/`, no `nexbot/backend/` |
| `TENANT_ID` vacío | No se registró aún | Registrarse primero, copiar el UUID de Supabase |
