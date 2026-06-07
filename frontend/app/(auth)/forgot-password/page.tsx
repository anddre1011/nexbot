'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }

    setMessage('Te enviamos un enlace para crear una nueva contrasena. Revisa tu correo.')
  }

  return (
    <main
      style={{ background: 'radial-gradient(ellipse at 60% 0%, #1a0a2e 0%, #0a0a0f 50%, #0d1117 100%)' }}
      className="min-h-screen flex items-center justify-center px-4 py-12"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-2xl">
        <h1 className="text-2xl font-bold text-white">Recuperar acceso</h1>
        <p className="mt-2 text-sm text-gray-400">Escribe tu email y te mandamos el enlace para cambiar tu contrasena.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
          {message && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-3 text-sm font-bold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Enviando...' : 'Enviar enlace'}
          </button>
        </form>

        <Link href="/login" className="mt-6 block text-center text-sm font-semibold text-violet-300 hover:text-violet-200">
          Volver al login
        </Link>
      </div>
    </main>
  )
}
