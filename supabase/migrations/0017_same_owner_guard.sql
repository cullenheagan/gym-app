-- Stop one account from linking its rows to another account's rows.
-- Row-level security already hides other accounts' rows, so when one of these triggers looks up a
-- row that belongs to someone else it finds nothing and refuses the save. Runs as the signed-in
-- user (security invoker), so it needs no extra permissions and changes no existing data.

create or replace function public.require_same_owner() returns trigger
language plpgsql
set search_path = public
as $$
declare
  ok boolean := true;
begin
  if tg_table_name = 'workout_sets' then
    ok := exists (select 1 from workouts w where w.id = new.workout_id and w.user_id = new.user_id)
      and exists (select 1 from exercises e where e.id = new.exercise_id and e.user_id = new.user_id)
      and (new.setup_id is null or exists (select 1 from exercise_setups x where x.id = new.setup_id and x.user_id = new.user_id));
  elsif tg_table_name = 'workouts' then
    ok := new.gym_id is null or exists (select 1 from gyms g where g.id = new.gym_id and g.user_id = new.user_id);
  elsif tg_table_name = 'exercises' then
    ok := new.gym_id is null or exists (select 1 from gyms g where g.id = new.gym_id and g.user_id = new.user_id);
  elsif tg_table_name = 'exercise_setups' then
    ok := exists (select 1 from exercises e where e.id = new.exercise_id and e.user_id = new.user_id)
      and (new.gym_id is null or exists (select 1 from gyms g where g.id = new.gym_id and g.user_id = new.user_id));
  elsif tg_table_name = 'profiles' then
    ok := new.default_gym_id is null or exists (select 1 from gyms g where g.id = new.default_gym_id and g.user_id = new.id);
  end if;
  if not ok then
    raise exception 'That record belongs to a different account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_same_owner() from public, anon, authenticated;

create trigger workout_sets_same_owner before insert or update on public.workout_sets
  for each row execute function public.require_same_owner();
create trigger workouts_same_owner before insert or update on public.workouts
  for each row execute function public.require_same_owner();
create trigger exercises_same_owner before insert or update on public.exercises
  for each row execute function public.require_same_owner();
create trigger exercise_setups_same_owner before insert or update on public.exercise_setups
  for each row execute function public.require_same_owner();
create trigger profiles_same_owner before insert or update on public.profiles
  for each row execute function public.require_same_owner();
