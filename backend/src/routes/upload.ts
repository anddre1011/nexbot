import { Router } from 'express'
import multer from 'multer'
import { v4 as uuid } from 'uuid'
import { supabase } from '../services/supabase'
import { requireAuth } from '../middleware/auth'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Solo se permiten imágenes'))
  },
})

// ─── POST /api/upload/product-banner ──────────────────────────────────────────
router.post(
  '/product-banner',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      const file = (req as any).file as Express.Multer.File
      if (!file) return res.status(400).json({ error: 'No se recibió archivo' })

      const tenantId = (req as any).tenantId as string
      const ext = file.originalname.split('.').pop() ?? 'png'
      const fileName = `${tenantId}/products/${uuid()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        })

      if (uploadError) {
        console.error('[upload] Supabase storage error:', uploadError)
        return res.status(500).json({ error: 'Error al subir archivo a storage' })
      }

      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(fileName)

      return res.json({ url: urlData.publicUrl })
    } catch (err: any) {
      console.error('[upload]', err)
      return res.status(500).json({ error: err.message ?? 'Error interno' })
    }
  }
)

export default router
