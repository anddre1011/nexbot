'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError('Credenciales incorrectas. Verifica tu email y contraseña.'); setLoading(false); return }
    router.push('/dashboard')
  }

  return (
    <main style={{ background: 'radial-gradient(ellipse at 60% 0%, #1a0a2e 0%, #0a0a0f 50%, #0d1117 100%)' }}
      className="min-h-screen flex items-center justify-center px-4 py-12">

      {/* Orbs decorativos */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)' }}
          className="absolute -top-40 -right-40 h-96 w-96 rounded-full" />
        <div style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, transparent 70%)' }}
          className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center justify-center">
            <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
              <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
          </div>
          <h1 style={{ background: 'linear-gradient(135deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            className="text-4xl font-extrabold tracking-tight">
            NexBot
          </h1>
          <p className="mt-2 text-sm text-gray-400">Tu plataforma de ventas WhatsApp + IA</p>
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)' }}
          className="rounded-3xl p-8 shadow-2xl">

          <h2 className="mb-6 text-xl font-semibold text-white">Iniciar sesión</h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Email
              </label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Contraseña
              </label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                className="rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{ background: loading ? 'rgba(124,58,237,0.5)' : 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="mt-1 w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-violet-500/25 disabled:cursor-not-allowed"
            >
              {loading ? 'Ingresando...' : 'Iniciar sesión →'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="font-semibold text-violet-400 hover:text-violet-300 transition-colors">
              Crear cuenta gratis
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-600 leading-relaxed">
          Al continuar aceptas nuestros Términos de Servicio y nuestra Política de Privacidad.
          NexBot utiliza IA avanzada para optimizar tus conversaciones de ventas.
        </p>
      </div>
    </main>
  )
}
