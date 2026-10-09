-- Photos for machines. Each photo lives in a private storage bucket under the owner's folder:
--   equipment-photos/<user id>/<exercise id>.jpg

alter table public.exercises add column if not exists photo_path text;

insert into storage.buckets (id, name, public)
values ('equipment-photos', 'equipment-photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos read" on storage.objects;
drop policy if exists "own photos insert" on storage.objects;
drop policy if exists "own photos update" on storage.objects;
drop policy if exists "own photos delete" on storage.objects;

create policy "own photos read" on storage.objects for select to authenticated
  using (bucket_id = 'equipment-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'equipment-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos update" on storage.objects for update to authenticated
  using (bucket_id = 'equipment-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'equipment-photos' and (storage.foldername(name))[1] = auth.uid()::text);
