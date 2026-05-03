'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const sections = [
  { href: '/configuracion/conexion',      label: 'Conexión',       icon: '🔌' },
  { href: '/configuracion/medias',         label: 'Medias',         icon: '🖼️' },
  { href: '/configuracion/compania',       label: 'Compañía',       icon: '🏢' },
  { href: '/configuracion/integraciones',  label: 'Integraciones',  icon: '⚙️' },
  { href: '/configuracion/equipo',         label: 'Equipo',         icon: '👥' },
  { href: '/configuracion/facturacion',    label: 'Facturación',    icon: '💳' },
]

export default function ConfigSubnav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-0.5">
      {sections.map(({ href, label, icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link key={href} href={href}
            style={active ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(37,99,235,0.12))', borderLeft: '2px solid #7c3aed' } : {}}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              active ? 'text-violet-300' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'
            }`}>
            <span className="text-base leading-none">{icon}</span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
