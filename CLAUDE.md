# NexBot — Reglas de Claude Code

## Autonomía
- Ejecuta sin pedir permiso salvo que borres archivos o cambies arquitectura base
- No preguntes "¿puedo proceder?" — procede directamente
- No pidas confirmación para crear o editar archivos

## Eficiencia de tokens
- Lee solo el rango de código necesario, nunca archivos completos innecesariamente
- Usa grep/búsqueda antes de leer archivos
- Respuestas cortas y directas, sin preámbulos
- No expliques lo que vas a hacer, hazlo

## Flujo de trabajo
- Avanza paso a paso sin pausas innecesarias
- Agrupa cambios relacionados en una sola operación
- Solo detente si hay un error real o decisión que cambia el rumbo del proyecto

## Proyecto
- NexBot: SaaS de WhatsApp + IA
- Stack: Next.js, Supabase, n8n, Typebot, OpenAI, WhatsApp Cloud API
