import 'dotenv/config'
import express from 'express'
import { runAgent } from './agent'
import { validateVoucher } from './validator'

const app  = express()
const PORT = process.env.AI_AGENT_PORT ?? 3002

app.use(express.json({ limit: '10mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// POST /agent — respuesta IA para un mensaje entrante
app.post('/agent', async (req, res) => {
  try {
    const result = await runAgent(req.body)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'agent error' })
  }
})

// POST /validate — validación de comprobante de pago
app.post('/validate', async (req, res) => {
  const { imageUrl, expectedAmount } = req.body
  if (!imageUrl || expectedAmount == null) {
    res.status(400).json({ error: 'imageUrl and expectedAmount are required' }); return
  }
  try {
    const result = await validateVoucher(imageUrl, Number(expectedAmount))
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'validator error' })
  }
})

app.listen(PORT, () => {
  console.log(`NexBot AI Agent running on http://localhost:${PORT}`)
})
