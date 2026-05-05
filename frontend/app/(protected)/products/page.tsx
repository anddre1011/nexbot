'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

// ─── tipos ────────────────────────────────────────────────────────────────────
interface Product {
  id:           string
  folder:       string
  name:         string
  type:         ProductType
  price:        number
  currency:     string
  banner_url:   string | null
  description:  string | null
  delivery_url: string | null
  active:       boolean
  created_at:   string
  upsell:       { id: string; name: string } | null
  downsell:     { id: string; name: string } | null
}

type ProductType = 'infoproduct' | 'digital' | 'physical' | 'other'

const TYPE_LABEL: Record<ProductType, string> = {
  infoproduct: 'Infoproducto',
  digital:     'Digital',
  physical:    'Físico',
  other:       'Otro',
}

const TYPE_COLOR: Record<ProductType, string> = {
  infoproduct: 'bg-violet-500/15 text-violet-300',
  digital:     'bg-sky-500/15 text-sky-300',
  physical:    'bg-amber-500/15 text-amber-300',
  other:       'bg-gray-500/15 text-gray-400',
}

// ─── página principal ─────────────────────────────────────────────────────────
export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState<'create' | Product | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(['General']))

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<Product[]>('/api/products')
      setProducts(data)
      // abrir todas las carpetas al cargar
      setOpenFolders(new Set(data.map((p) => p.folder)))
    } catch (err) { console.error('[products]', err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este producto?')) return
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' })
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  async function toggleActive(product: Product) {
    const next = !product.active
    setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, active: next } : p))
    apiFetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: next }),
    }).catch(() => fetchProducts())
  }

  function toggleFolder(folder: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      return next
    })
  }

  // agrupar por carpeta
  const folders = [...new Set(products.map((p) => p.folder))].sort()
  const byFolder = (f: string) => products.filter((p) => p.folder === f)

  const totalProducts = products.length
  const totalValue    = products
    .filter((p) => p.active)
    .reduce((s, p) => s + p.price, 0)

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-[#0f0f0f] text-gray-100">

      {/* ── barra superior ── */}
      <div className="shrink-0 border-b border-white/5 bg-[#141414] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-4">
            <h1 className="text-xl font-bold text-gray-100">Productos</h1>
            <span className="text-sm text-gray-500">{loading ? '…' : totalProducts} productos</span>
            <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-400">
              catálogo activo
            </span>
          </div>
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Crear Producto
          </button>
        </div>
      </div>

      {/* ── contenido ── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <p className="text-center text-sm text-gray-600 py-16">Cargando productos...</p>
        ) : folders.length === 0 ? (
          <EmptyState onAdd={() => setModal('create')} />
        ) : (
          <div className="flex flex-col gap-4">
            {folders.map((folder) => (
              <FolderSection
                key={folder}
                folder={folder}
                products={byFolder(folder)}
                open={openFolders.has(folder)}
                onToggle={() => toggleFolder(folder)}
                onEdit={(p) => setModal(p)}
                onDelete={handleDelete}
                onToggleActive={toggleActive}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── modal ── */}
      {modal && (
        <ProductModal
          product={modal === 'create' ? null : modal}
          allProducts={products}
          onClose={() => setModal(null)}
          onSaved={fetchProducts}
        />
      )}
    </div>
  )
}

// ─── carpeta ──────────────────────────────────────────────────────────────────
function FolderSection({
  folder, products, open, onToggle, onEdit, onDelete, onToggleActive,
}: {
  folder: string
  products: Product[]
  open: boolean
  onToggle: () => void
  onEdit: (p: Product) => void
  onDelete: (id: string) => void
  onToggleActive: (p: Product) => void
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#141414] overflow-hidden">
      {/* header carpeta */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/5"
      >
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <svg className="h-4 w-4 text-yellow-500/70" fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span className="text-sm font-medium text-gray-200">{folder}</span>
        <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-500">
          {products.length}
        </span>
      </button>

      {/* tabla */}
      {open && (
        <table className="w-full text-sm border-t border-white/5">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5 font-mono text-[10px]">ID</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5 text-right">Precio (BOB)</th>
              <th className="px-4 py-2.5">Upsell</th>
              <th className="px-4 py-2.5">Downsell</th>
              <th className="px-4 py-2.5 text-center">Activo</th>
              <th className="px-4 py-2.5 w-16" />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr
                key={p.id}
                className="border-t border-white/[0.04] hover:bg-white/[0.03] transition-colors"
              >
                {/* nombre */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
                      <ProductIcon type={p.type} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-100">{p.name}</p>
                      {p.description && (
                        <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-1">{p.description}</p>
                      )}
                    </div>
                  </div>
                </td>

                {/* id corto */}
                <td className="px-4 py-3">
                  <span className="font-mono text-[10px] text-gray-600">{p.id.slice(0, 8)}</span>
                </td>

                {/* tipo */}
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${TYPE_COLOR[p.type]}`}>
                    {TYPE_LABEL[p.type]}
                  </span>
                </td>

                {/* precio */}
                <td className="px-4 py-3 text-right font-bold text-emerald-400">
                  {p.price.toFixed(2)}
                </td>

                {/* upsell */}
                <td className="px-4 py-3 text-xs text-violet-300">
                  {p.upsell?.name ?? <span className="text-gray-600">–</span>}
                </td>

                {/* downsell */}
                <td className="px-4 py-3 text-xs text-sky-300">
                  {p.downsell?.name ?? <span className="text-gray-600">–</span>}
                </td>

                {/* activo toggle */}
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onToggleActive(p)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${p.active ? 'bg-indigo-600' : 'bg-white/10'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${p.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </td>

                {/* acciones */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEdit(p)}
                      className="rounded p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDelete(p.id)}
                      className="rounded p-1.5 text-gray-600 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── modal crear / editar ─────────────────────────────────────────────────────
function ProductModal({
  product, allProducts, onClose, onSaved,
}: {
  product:     Product | null
  allProducts: Product[]
  onClose:     () => void
  onSaved:     () => void
}) {
  const isEdit = !!product

  const [name,        setName]        = useState(product?.name         ?? '')
  const [type,        setType]        = useState<ProductType>(product?.type ?? 'digital')
  const [price,       setPrice]       = useState(String(product?.price ?? ''))
  const [currency,    setCurrency]    = useState(product?.currency     ?? 'BOB')
  const [bannerUrl,   setBannerUrl]   = useState(product?.banner_url   ?? '')
  const [description, setDescription] = useState(product?.description  ?? '')
  const [deliveryUrl, setDeliveryUrl] = useState(product?.delivery_url ?? '')
  const [folder,      setFolder]      = useState(product?.folder       ?? 'General')
  const [upsellId,    setUpsellId]    = useState(product?.upsell?.id   ?? '')
  const [downsellId,  setDownsellId]  = useState(product?.downsell?.id ?? '')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const CURRENCIES = [
    { code: 'BOB', label: 'BOB - Boliviano', flag: '🇧🇴' },
    { code: 'BRL', label: 'BRL - Real Brasileño', flag: '🇧🇷' },
    { code: 'COP', label: 'COP - Peso Colombiano', flag: '🇨🇴' },
    { code: 'ARS', label: 'ARS - Peso Argentino', flag: '🇦🇷' },
    { code: 'PEN', label: 'PEN - Sol Peruano', flag: '🇵🇪' },
    { code: 'USD', label: 'USD - Dólar', flag: '🇺🇸' },
    { code: 'MXN', label: 'MXN - Peso Mexicano', flag: '🇲🇽' },
  ]

  const others = allProducts.filter((p) => p.id !== product?.id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim())   { setError('El nombre es obligatorio'); return }
    if (!price)         { setError('El precio es obligatorio'); return }
    setLoading(true); setError('')

    const body = {
      name: name.trim(), type, price: Number(price), currency,
      banner_url: bannerUrl.trim() || null,
      description: description.trim() || null,
      delivery_url: deliveryUrl.trim() || null,
      folder: folder.trim() || 'General',
      upsell_id:   upsellId   || null,
      downsell_id: downsellId || null,
    }

    try {
      if (isEdit) {
        await apiFetch(`/api/products/${product!.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(body) })
      }
      onSaved(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-[#1a1a1a] shadow-2xl ring-1 ring-white/10">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? 'Editar producto' : 'Crear producto'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 px-6 py-5">
            {/* nombre */}
            <div className="col-span-2">
              <MField label="Nombre del producto" required>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Curso de Marketing Digital"
                  className="modal-input" />
              </MField>
            </div>

            {/* tipo */}
            <MField label="Tipo">
              <select value={type} onChange={(e) => setType(e.target.value as ProductType)}
                className="modal-input">
                <option value="infoproduct">Infoproducto</option>
                <option value="digital">Digital</option>
                <option value="physical">Físico</option>
                <option value="other">Otro</option>
              </select>
            </MField>

            {/* moneda */}
            <MField label="Moneda">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="modal-input">
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                ))}
              </select>
            </MField>

            {/* precio */}
            <MField label={`Precio (${currency})`} required>
              <input type="number" min="0" step="0.01" value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="97.00"
                className="modal-input" />
            </MField>

            {/* banner */}
            <div className="col-span-2">
              <MField label="Banner (URL imagen 1920x1080)">
                <input value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)}
                  placeholder="https://supabase.co/storage/v1/..." className="modal-input" />
              </MField>
            </div>

            {/* carpeta */}
            <div className="col-span-2">
              <MField label="Carpeta">
                <input value={folder} onChange={(e) => setFolder(e.target.value)}
                  placeholder="General" className="modal-input" />
              </MField>
            </div>

            {/* descripción */}
            <div className="col-span-2">
              <MField label="Descripción">
                <textarea rows={2} value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descripción breve del producto..."
                  className="modal-input resize-none" />
              </MField>
            </div>

            {/* url de entrega */}
            <div className="col-span-2">
              <MField label="URL de entrega">
                <input value={deliveryUrl} onChange={(e) => setDeliveryUrl(e.target.value)}
                  placeholder="https://drive.google.com/..." className="modal-input" />
              </MField>
              <p className="mt-1 text-[10px] text-gray-500">
                Se envía automáticamente al cliente cuando se confirma el pago
              </p>
            </div>

            {/* upsell */}
            <MField label="Upsell">
              <select value={upsellId} onChange={(e) => setUpsellId(e.target.value)}
                className="modal-input">
                <option value="">Sin upsell</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </MField>

            {/* downsell */}
            <MField label="Downsell">
              <select value={downsellId} onChange={(e) => setDownsellId(e.target.value)}
                className="modal-input">
                <option value="">Sin downsell</option>
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </MField>
          </div>

          {error && (
            <p className="mx-6 mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2 border-t border-white/5 px-6 py-4">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-gray-400 hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
        <svg className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <p className="text-sm text-gray-500">Sin productos aún</p>
      <button onClick={onAdd}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
        Crear primer producto
      </button>
    </div>
  )
}

function ProductIcon({ type }: { type: ProductType }) {
  if (type === 'physical') return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )
  if (type === 'infoproduct') return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function MField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-400">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
