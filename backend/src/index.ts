import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { supabase } from './services/supabase'

import authRoutes from './routes/auth'
import whatsappRoutes from './routes/whatsapp'
import contactsRoutes from './routes/contacts'
import salesRoutes from './routes/sales'
import campaignsRoutes from './routes/campaigns'
import analyticsRoutes from './routes/analytics'
import tenantsRoutes       from './routes/tenants'
import conversationsRoutes from './routes/conversations'
import productsRoutes      from './routes/products'
import flowsRoutes         from './routes/flows'
import automationRoutes    from './routes/automation'
import metaAdsRoutes       from './routes/meta-ads'
import billingRoutes       from './routes/billing'
import mediaRoutes         from './routes/media'
import uploadRoutes        from './routes/upload'
import notificationsRoutes from './routes/notifications'
import conversionsRoutes   from './routes/conversions'
import { startInactivityWorker } from './services/inactivity'
import { startCapiRetryWorker } from './services/capi.service'

const app = express()
const PORT = process.env.PORT ?? 3001
const fallbackAllowedOrigins = [
  'https://app.nexbot.pro',
  'https://nexbot.pro',
  'https://www.nexbot.pro',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? fallbackAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`))
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
})

app.use(corsMiddleware)
app.options('*', corsMiddleware)
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// Política de privacidad — requerida por Meta para publicar la app
app.get('/privacy.html', (_req, res) => {
  res.redirect(301, 'https://app.nexbot.pro/privacy.html')
})
app.get('/privacy', (_req, res) => {
  res.redirect(301, 'https://app.nexbot.pro/privacy.html')
})

app.use('/api/auth',      authRoutes)
app.use('/api/whatsapp',  whatsappRoutes)
app.use('/api/contacts',  contactsRoutes)
app.use('/api/sales',     salesRoutes)
app.use('/api/campaigns', campaignsRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/tenants',       tenantsRoutes)
app.use('/api/conversations', conversationsRoutes)
app.use('/api/products',     productsRoutes)
app.use('/api/flows',        flowsRoutes)
app.use('/api/automation',   automationRoutes)
app.use('/api/meta-ads',     metaAdsRoutes)
app.use('/api/billing',      billingRoutes)
app.use('/api/media',         mediaRoutes)
app.use('/api/upload',        uploadRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/conversions',   conversionsRoutes)

app.listen(PORT, async () => {
  console.log(`NexBot backend running on http://localhost:${PORT}`)
  startInactivityWorker()
  startCapiRetryWorker()

  // Crear bucket "media" si no existe
  const { error } = await supabase.storage.createBucket('media', { public: true })
  if (error && !error.message.includes('already exists')) {
    console.warn('[storage] Could not create bucket "media":', error.message)
  } else {
    console.log('[storage] Bucket "media" ready')
  }
})
