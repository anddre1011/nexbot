'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('La contrasena debe tener minimo 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contrasenas no coinciden.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <main
      style={{ background: 'radial-gradient(ellipse at 60% 0%, #1a0a2e 0%, #0a0a0f 50%, #0d1117 100%)' }}
      className="min-h-screen flex items-center justify-center px-4 py-12"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-2xl">
        <h1 className="text-2xl font-bold text-white">Nueva contrasena</h1>
        <p className="mt-2 text-sm text-gray-400">Crea una contrasena nueva y luego vuelve a iniciar sesion.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contrasena"
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repetir contrasena"
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-3 text-sm font-bold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Guardando...' : 'Guardar contrasena'}
          </button>
        </form>
      </div>
    </main>
  )
}
