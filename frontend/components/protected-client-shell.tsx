'use client'

import { useEffect, useState } from 'react'
import AppShell from './app-shell'
import { createClient } from '@/lib/supabase/client'

export default function ProtectedClientShell({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    createClient().auth.getUser()
      .then(({ data }) => {
        if (!alive) return
        if (!data.user) {
          window.location.replace('/login')
          return
        }
        setEmail(data.user.email ?? '')
      })
      .catch(() => {
        if (alive) window.location.replace('/login')
      })

    return () => { alive = false }
  }, [])

  if (email === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-sm text-gray-500">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full bg-gradient-to-br from-violet-600 to-blue-600 opacity-70" />
          Cargando NexBot...
        </div>
      </div>
    )
  }

  return <AppShell email={email}>{children}</AppShell>
}
