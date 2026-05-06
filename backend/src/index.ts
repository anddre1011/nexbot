import 'dotenv/config'
import express from 'express'
import cors from 'cors'

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

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
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
app.use('/api/media',        mediaRoutes)
app.use('/api/upload',       uploadRoutes)

app.listen(PORT, () => {
  console.log(`NexBot backend running on http://localhost:${PORT}`)
})
