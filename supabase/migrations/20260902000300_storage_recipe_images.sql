-- ============================================================
-- Storage bucket: recipe-images（private）
--  パス: {group_id}/{recipe_id}/{filename}
--  RLS : 先頭フォルダ = group_id のメンバーのみ
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- オブジェクト名の先頭フォルダを group_id として取り出す（uuid でなければ null）
create or replace function public.recipe_image_group_id(p_object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_object_name))[1]
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (storage.foldername(p_object_name))[1]::uuid
    else null
  end;
$$;

-- パスが {group_id}/{recipe_id}/{filename} の3階層で、group のメンバーか
create or replace function public.can_access_recipe_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select array_length(storage.foldername(p_object_name), 1) = 2
     and public.recipe_image_group_id(p_object_name) is not null
     and public.is_group_member(public.recipe_image_group_id(p_object_name));
$$;

revoke execute on function public.can_access_recipe_image(text) from public, anon;
grant execute on function public.can_access_recipe_image(text) to authenticated, service_role;

drop policy if exists "recipe_images_select_member" on storage.objects;
drop policy if exists "recipe_images_insert_member" on storage.objects;
drop policy if exists "recipe_images_update_member" on storage.objects;
drop policy if exists "recipe_images_delete_member" on storage.objects;

create policy "recipe_images_select_member" on storage.objects
  for select to authenticated
  using (bucket_id = 'recipe-images' and public.can_access_recipe_image(name));

create policy "recipe_images_insert_member" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipe-images' and public.can_access_recipe_image(name));

create policy "recipe_images_update_member" on storage.objects
  for update to authenticated
  using (bucket_id = 'recipe-images' and public.can_access_recipe_image(name))
  with check (bucket_id = 'recipe-images' and public.can_access_recipe_image(name));

create policy "recipe_images_delete_member" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recipe-images' and public.can_access_recipe_image(name));
