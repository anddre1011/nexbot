import ConfigSubnav from '@/components/config-subnav'

export default function ConfiguracionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen bg-[#0a0a0f]">
      {/* Sub-nav */}
      <aside style={{ background: '#0d0d14', borderRight: '1px solid rgba(255,255,255,0.06)' }}
        className="w-52 shrink-0 px-3 py-6">
        <p className="mb-4 px-3 text-[10px] font-bold uppercase tracking-widest text-gray-600">
          Configuración
        </p>
        <ConfigSubnav />
      </aside>

      {/* Contenido */}
      <div className="flex-1 overflow-auto p-8">
        {children}
      </div>
    </div>
  )
}
