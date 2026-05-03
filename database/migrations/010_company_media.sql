-- Migración 010 — datos de compañía, integraciones y tabla de medias

-- Columnas extra en tenants
alter table public.tenants
  add column if not exists logo_url        text,
  add column if not exists timezone        text not null default 'America/La_Paz',
  add column if not exists language        text not null default 'es',
  add column if not exists elevenlabs_key  text;

-- Tabla de medias (archivos subidos por cada tenant)
create table public.media (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('image', 'video', 'audio', 'document')),
  url         text not null,
  size_bytes  integer,
  folder      text not null default 'General',
  variable    text,                          -- {{media:nombre}} para usar en flujos
  created_at  timestamptz not null default now()
);

create index idx_media_tenant_id on public.media(tenant_id);
create index idx_media_folder    on public.media(tenant_id, folder);

alter table public.media enable row level security;
create policy "media: own tenant" on public.media
  for all using (tenant_id in (select auth.tenant_ids()));

-- Bucket de Supabase Storage para medias (ejecutar en SQL Editor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 52428800,
  array['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','audio/mpeg','audio/ogg','application/pdf']
)
on conflict (id) do nothing;

-- Política de Storage: solo el tenant dueño puede subir/borrar
create policy "media storage: own tenant upload" on storage.objects
  for insert with check (bucket_id = 'media' and auth.uid() is not null);

create policy "media storage: public read" on storage.objects
  for select using (bucket_id = 'media');

create policy "media storage: own tenant delete" on storage.objects
  for delete using (bucket_id = 'media' and auth.uid() is not null);
