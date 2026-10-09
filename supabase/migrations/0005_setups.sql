-- Seat / bench setups. One exercise at one gym can have several (the bench by the window,
-- the bench in the corner), each with a photo and a pin position.

create table if not exists public.exercise_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  gym_id uuid references public.gyms (id) on delete cascade,
  name text not null,
  pin_position text,
  photo_path text,
  created_at timestamptz not null default now()
);

create index if not exists exercise_setups_lookup_idx on public.exercise_setups (user_id, exercise_id, gym_id);

alter table public.exercise_setups enable row level security;

drop policy if exists "own setups" on public.exercise_setups;
create policy "own setups" on public.exercise_setups for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.exercise_setups to authenticated;

-- Which setup each logged set used.
alter table public.workout_sets
  add column if not exists setup_id uuid references public.exercise_setups (id) on delete set null;
