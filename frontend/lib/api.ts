import { createClient } from './supabase/client'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function getToken(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

interface ApiFetchInit extends RequestInit {
  rawBody?: boolean
}

export async function apiFetch<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  // Solo agregar Content-Type json si NO es rawBody (FormData maneja su propio Content-Type)
  if (!init?.rawBody) {
    headers['Content-Type'] = 'application/json'
  }

  const { rawBody, ...fetchInit } = init ?? {} as ApiFetchInit

  const res = await fetch(`${BASE}${path}`, {
    ...fetchInit,
    headers: {
      ...headers,
      ...fetchInit?.headers as Record<string, string>,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}
