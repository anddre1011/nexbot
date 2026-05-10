'use client'

import { useState } from 'react'
import Sidebar from './sidebar'

export default function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ background: '#0a0a0f' }} className="flex min-h-screen">

      {/* Overlay móvil */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — fijo en móvil, normal en desktop */}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:static md:translate-x-0 md:block ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <Sidebar email={email} onCloseMobile={() => setOpen(false)} />
      </div>

      {/* Contenido principal */}
      <main className="flex-1 min-w-0 overflow-auto flex flex-col">
        {/* Barra superior solo en móvil */}
        <div style={{ background: '#0d0d14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          className="flex md:hidden shrink-0 items-center gap-3 px-4 py-3">
          <button
            onClick={() => setOpen(true)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div style={{ background: 'linear-gradient(135deg, #7c3aed, #2563eb)' }}
              className="flex h-6 w-6 items-center justify-center rounded-md">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <span style={{ background: 'linear-gradient(135deg, #a78bfa, #60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
              className="text-base font-extrabold tracking-tight">
              NexBot
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
