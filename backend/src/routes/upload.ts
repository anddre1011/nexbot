import { Router } from 'express'
import multer from 'multer'
import { v4 as uuid } from 'uuid'
import { supabase } from '../services/supabase'
import { requireAuth } from '../middlewares/auth'

const router = Router()
router.use(requireAuth)

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Solo se permiten imágenes'))
  },
})

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB para video
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')
      || file.mimetype.startsWith('audio/') || file.mimetype === 'application/pdf'
    if (ok) cb(null, true)
    else cb(new Error('Tipo de archivo no permitido'))
  },
})

// alias para backward compat
const upload = imageUpload

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .single()
  return data?.id ?? null
}

// ─── POST /api/upload/product-banner ──────────────────────────────────────────
router.post('/product-banner', upload.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' })

    const userId = res.locals.user?.id
    if (!userId) return res.status(401).json({ error: 'No autenticado' })

    const tenantId = await getTenantId(userId)
    if (!tenantId) return res.status(404).json({ error: 'Tenant no encontrado' })

    const ext = file.originalname.split('.').pop() ?? 'png'
    const fileName = `${tenantId}/products/${uuid()}.${ext}`

    // Intentar subir al bucket 'media' (debe existir en Supabase Storage)
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) {
      console.error('[upload] Storage error:', uploadError.message)
      // Si el bucket no existe, dar instrucción clara
      if (uploadError.message.includes('not found') || uploadError.message.includes('Bucket')) {
        return res.status(500).json({
          error: 'Bucket "media" no existe en Supabase Storage. Créalo en: Supabase → Storage → New Bucket → "media" (público)'
        })
      }
      return res.status(500).json({ error: `Error al subir: ${uploadError.message}` })
    }

    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(fileName)

    return res.json({ url: urlData.publicUrl })
  } catch (err: any) {
    console.error('[upload] Error:', err.message)
    return res.status(500).json({ error: err.message ?? 'Error interno' })
  }
})

// ─── POST /api/upload/flow-media ─────────────────────────────────────────────
router.post('/flow-media', mediaUpload.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' })

    const userId = res.locals.user?.id
    const tenantId = await getTenantId(userId)
    if (!tenantId) return res.status(404).json({ error: 'Tenant no encontrado' })

    const ext = file.originalname.split('.').pop() ?? 'bin'
    const folder = file.mimetype.startsWith('image/') ? 'images'
      : file.mimetype.startsWith('video/') ? 'videos'
      : file.mimetype.startsWith('audio/') ? 'audio' : 'files'
    const fileName = `${tenantId}/flows/${folder}/${uuid()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('media').upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false })

    if (uploadError) return res.status(500).json({ error: uploadError.message })

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName)
    return res.json({ url: urlData.publicUrl, type: folder.slice(0, -1) }) // 'image','video','audio','file'
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
})

export default router
