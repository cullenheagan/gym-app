-- Gyms can have a photo, and can be removed from your list without losing anything.
-- "Removed" gyms keep their workouts and machines; they just stop showing in the gym dropdown.

alter table public.gyms add column if not exists photo_path text;
alter table public.gyms add column if not exists archived_at timestamptz;
