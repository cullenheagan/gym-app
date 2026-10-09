-- handle_new_user() only needs to run as a sign-up trigger, never as a public API call.
-- (Applied through the Supabase connector; kept here so the repo matches the database.)

revoke execute on function public.handle_new_user() from public, anon, authenticated;
