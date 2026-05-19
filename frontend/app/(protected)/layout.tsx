import ProtectedClientShell from '@/components/protected-client-shell'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedClientShell>
      {children}
    </ProtectedClientShell>
  )
}
