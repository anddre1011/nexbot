import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1]

  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return
  }

  // Verificar JWT con Supabase usando el anon key (no el service key)
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  res.locals.user = user
  next()
}
