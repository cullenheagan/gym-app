-- Beginner accounts: "New to the gym? Get a plan" on the sign-in screen signs in anonymously
-- with user metadata mode = 'beginner' and opens only the beginner screen (My plan).
-- Those accounts are someone's real plan and goals, so the daily cleanup keeps them while they
-- are used and deletes them after 30 days without use (no sign-in or session refresh).
-- Guest demo accounts (anonymous, no mode) are still deleted 7 days after they were made.
-- No tables change and no existing data is changed by this file.

create or replace function public.delete_old_guests() returns void
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(u.id), '{}') into ids
  from auth.users u
  where u.is_anonymous
    and (
      (coalesce(u.raw_user_meta_data ->> 'mode', '') <> 'beginner'
        and u.created_at < now() - interval '7 days')
      or
      (u.raw_user_meta_data ->> 'mode' = 'beginner'
        and greatest(
          u.created_at,
          coalesce(u.last_sign_in_at, u.created_at),
          coalesce((select max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at))
                    from auth.sessions s where s.user_id = u.id), u.created_at)
        ) < now() - interval '30 days')
    );
  -- Sets go first because a set blocks its exercise from being deleted; the rest follows the
  -- account (on delete cascade).
  delete from public.workout_sets where user_id = any(ids);
  delete from auth.users where id = any(ids);
end;
$$;
revoke execute on function public.delete_old_guests() from public, anon, authenticated;
