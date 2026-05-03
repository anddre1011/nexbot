# Build context: nexbot/ (raíz del monorepo)
# El backend importa ai-agent via rutas relativas — ambos deben estar en el mismo layer

# ── Stage 1: dependencias ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY backend/package*.json  ./backend/
COPY ai-agent/package*.json ./ai-agent/

RUN cd backend  && npm ci
RUN cd ai-agent && npm ci

# ── Stage 2: producción ───────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/backend/node_modules  ./backend/node_modules
COPY --from=deps /app/ai-agent/node_modules ./ai-agent/node_modules

# Copiar fuentes (tsx ejecuta TypeScript directamente)
COPY backend  ./backend
COPY ai-agent ./ai-agent

WORKDIR /app/backend

EXPOSE 3001

# tsx ejecuta TypeScript directamente sin compilar — evita problemas de rutas relativas
CMD ["npx", "tsx", "src/index.ts"]
