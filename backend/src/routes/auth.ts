import { Router } from 'express'
import { supabase } from '../services/supabase'
import { ensureTenantForUser } from '../services/tenants'

const router = Router()

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: name },
    email_confirm: true,
  })

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  if (data.user) {
    await ensureTenantForUser(data.user)
  }

  res.status(201).json({ user: data.user })
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    res.status(401).json({ error: error.message })
    return
  }

  res.json({ session: data.session, user: data.user })
})

export default router
