-- A name to greet you with on the Home screen ("Hi, Cullen"). Optional; existing rows are untouched.

alter table public.profiles add column if not exists display_name text;
