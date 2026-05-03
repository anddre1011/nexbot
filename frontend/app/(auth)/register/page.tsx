'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const router = useRouter()
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/dashboard')
  }

  return (
    <main style={{ background: 'radial-gradient(ellipse at 40% 0%, #0a1a2e 0%, #0a0a0f 50%, #0d0a17 100%)' }}
      className="min-h-screen flex items-center justify-center px-4 py-12">

      {/* Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)' }}
          className="absolute -top-40 -left-40 h-96 w-96 rounded-full" />
        <div style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }}
          className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center justify-center">
            <div style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
              <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
          </div>
          <h1 style={{ background: 'linear-gradient(135deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            className="text-4xl font-extrabold tracking-tight">
            NexBot
          </h1>
          <p className="mt-2 text-sm text-gray-400">Automatiza tus ventas con WhatsApp + IA</p>
        </div>

        {/* Badges de features */}
        <div className="mb-6 flex items-center justify-center gap-3 flex-wrap">
          {['GPT-4o', 'Multi-tenant', 'Meta Ads'].map((f) => (
            <span key={f} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}
              className="rounded-full px-3 py-1 text-xs font-medium text-violet-300">
              ✦ {f}
            </span>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)' }}
          className="rounded-3xl p-8 shadow-2xl">

          <h2 className="mb-6 text-xl font-semibold text-white">Crear cuenta gratis</h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Nombre del negocio
              </label>
              <input
                type="text" required value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mi Tienda Online"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Email
              </label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Contraseña
              </label>
              <input
                type="password" required minLength={8} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
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
              style={{ background: loading ? 'rgba(37,99,235,0.5)' : 'linear-gradient(135deg, #2563eb, #7c3aed)' }}
              className="mt-1 w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-blue-500/25 disabled:cursor-not-allowed"
            >
              {loading ? 'Creando cuenta...' : 'Empezar gratis →'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
              Iniciar sesión
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-gray-600">
          Sin tarjeta de crédito · Cancela cuando quieras
        </p>
      </div>
    </main>
  )
}
