-- A profile photo. The file lives in the private equipment-photos bucket under your own folder:
--   equipment-photos/<user id>/avatar.jpg

alter table public.profiles add column if not exists avatar_path text;
