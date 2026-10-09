-- Let signed-in users reach the Phase 1 tables through the Data API.
-- Row-level security (migration 0001) still limits every user to their own rows.
-- Deliberately not granted to the anon role: nothing here is readable signed out.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Cover tables added by later migrations too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
