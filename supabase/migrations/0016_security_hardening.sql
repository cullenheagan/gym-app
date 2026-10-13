-- Security hardening from the October 2026 audit.

-- Signed-in and signed-out users never need to empty a table, add triggers or make foreign keys
-- to these tables. The app's API can't do those anyway; this removes the permissions too.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- The app only uploads compressed JPEG photos (a few hundred KB). Refuse anything that isn't an image
-- or is over 5 MB. Existing photos are untouched.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'equipment-photos';
