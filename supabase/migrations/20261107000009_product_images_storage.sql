-- =====================================================================
-- amoka.retail ERP & POS  |  09 - Product photo storage (Supabase Storage)
-- Creates a public bucket "product-images". Anyone can view photos (needed for the catalog);
-- only staff with the "products" permission can upload, replace or delete them.
-- Run once in Supabase SQL Editor.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "product images: public read" on storage.objects;
create policy "product images: public read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "product images: staff upload" on storage.objects;
create policy "product images: staff upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.can('products'));

drop policy if exists "product images: staff update" on storage.objects;
create policy "product images: staff update" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.can('products'));

drop policy if exists "product images: staff delete" on storage.objects;
create policy "product images: staff delete" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.can('products'));
