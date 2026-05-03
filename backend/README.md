# backend/

API y lógica de negocio de NexBot — endpoints REST, validaciones, orquestación entre servicios.

**Stack:** Node.js, Express (o Next.js API routes), Supabase Admin client.

**Contenido futuro:**
- `routes/` — endpoints por módulo (auth, contacts, payments, campaigns)
- `services/` — lógica de negocio desacoplada
- `middlewares/` — auth JWT, validación de tenant, rate limiting
- `utils/` — helpers compartidos
