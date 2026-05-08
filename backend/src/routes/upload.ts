import { Router } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { supabase } from '../services/supabase'
import { requireAuth } from '../middlewares/auth'

const router = Router()
router.use(requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Solo se permiten imágenes'))
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
    const fileName = `${tenantId}/products/${crypto.randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) {
      console.error('[upload] Storage error:', uploadError.message)
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

export default router
