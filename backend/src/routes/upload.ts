import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { supabase } from '../services/supabase'
import { requireAuth } from '../middlewares/auth'

const router = Router()
router.use(requireAuth)

const MAX_FLOW_MEDIA_BYTES = 16 * 1024 * 1024

// ─── Multer para imágenes de productos (solo imagen, 2MB) ────────────────────
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Solo se permiten imágenes'))
  },
})

// ─── Multer para medias de flujos (imagen/video/audio/pdf, 16MB) ─────────────
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FLOW_MEDIA_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/', 'video/', 'audio/',
      'application/pdf',
      'application/octet-stream',
    ]
    if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true)
    else cb(new Error(`Tipo no permitido: ${file.mimetype}`))
  },
})

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .single()
  return data?.id ?? null
}

async function uploadToStorage(
  buffer: Buffer,
  mimetype: string,
  originalname: string,
  folder: string
): Promise<string> {
  const ext = originalname.split('.').pop() ?? 'bin'
  const fileName = `${folder}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from('media')
    .upload(fileName, buffer, { contentType: mimetype, upsert: false, cacheControl: '31536000' })

  if (error) {
    if (error.message.includes('not found') || error.message.toLowerCase().includes('bucket')) {
      throw new Error('Bucket "media" no existe en Supabase Storage. Ve a Supabase → Storage → New Bucket → nombre: "media" → público ✓')
    }
    throw new Error(error.message)
  }

  const { data } = supabase.storage.from('media').getPublicUrl(fileName)
  return data.publicUrl
}

// ─── POST /api/upload/product-banner ──────────────────────────────────────────
router.post('/product-banner', uploadImage.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' })

    const tenantId = await getTenantId(res.locals.user?.id)
    if (!tenantId) return res.status(404).json({ error: 'Tenant no encontrado' })

    const url = await uploadToStorage(file.buffer, file.mimetype, file.originalname, `${tenantId}/products`)
    return res.json({ url })
  } catch (err: any) {
    console.error('[upload/product-banner]', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/upload/flow-media ──────────────────────────────────────────────
// Sube cualquier media (imagen, video, audio, PDF) para usar en flujos
router.post('/flow-media', uploadMedia.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' })

    const tenantId = await getTenantId(res.locals.user?.id)
    if (!tenantId) return res.status(404).json({ error: 'Tenant no encontrado' })

    const url = await uploadToStorage(file.buffer, file.mimetype, file.originalname, `${tenantId}/flows`)
    return res.json({ url })
  } catch (err: any) {
    console.error('[upload/flow-media]', err.message)
    return res.status(500).json({ error: err.message })
  }
})

export default router
