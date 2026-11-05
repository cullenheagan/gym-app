-- My plan goals (HCI proposal F7): a weekly workout goal, such as 3 workouts a week.
-- Progress and streaks are worked out in the app from logged workouts. Editing a goal ends the
-- old row (ended_at) and adds a new one, so past weeks keep the goal they had. Ending a goal sets
-- ended_at. One open goal per person.
-- New table, so the grants are explicit. Guests' goals are deleted with their account.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'weekly_workouts' check (kind = 'weekly_workouts'),
  target smallint not null check (target between 1 and 7),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= created_at)
);

create unique index goals_one_open_per_user on public.goals (user_id) where ended_at is null;
create index goals_user_created on public.goals (user_id, created_at);

alter table public.goals enable row level security;

create policy "own goals" on public.goals for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.goals from anon, authenticated;
grant select, insert, update on public.goals to authenticated;
grant all on public.goals to service_role;
