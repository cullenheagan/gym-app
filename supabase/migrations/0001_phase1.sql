-- Phase 1: workout logger. Every table is owned by one user and protected by
-- row-level security, so accounts never see each other's data.
-- Weights are stored in kilograms; the UI converts for display.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  unit text not null default 'lb' check (unit in ('lb', 'kg')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  default_gym_id uuid,
  created_at timestamptz not null default now()
);

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_default_gym_fk
  foreign key (default_gym_id) references public.gyms (id) on delete set null;

-- A machine or adjustable bench at one gym. Free weights are not per gym.
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  gym_id uuid not null references public.gyms on delete cascade,
  name text not null,
  brand text,
  model text,
  loading_type text not null check (loading_type in ('pin', 'plate', 'cable', 'free_weight', 'bodyweight', 'other')),
  muscle_group text,
  photo_path text,
  settings jsonb not null default '{}'::jsonb, -- e.g. {"seat": 4, "back_pad": 2, "angle_pin": 4}
  created_at timestamptz not null default now()
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  equipment_type text not null check (equipment_type in ('free_weight', 'cable', 'pin_machine', 'plate_machine', 'bodyweight', 'other')),
  muscle_groups text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  gym_id uuid references public.gyms on delete set null,
  name text not null default 'Workout',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text
);

-- id is generated on the device so a retried sync never creates a duplicate set.
create table public.workout_sets (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  workout_id uuid not null references public.workouts on delete cascade,
  exercise_id uuid not null references public.exercises on delete restrict,
  machine_id uuid references public.machines on delete set null,
  set_index int not null,
  set_type text not null default 'working' check (set_type in ('warmup', 'working', 'drop', 'failure')),
  weight_kg numeric(7, 3),
  reps int,
  rpe numeric(3, 1),
  settings_used jsonb not null default '{}'::jsonb,
  completed_at timestamptz
);

create index on public.gyms (user_id);
create index on public.machines (user_id, gym_id);
create index on public.exercises (user_id);
create index on public.workouts (user_id, started_at desc);
create index on public.workout_sets (user_id, workout_id);
create index on public.workout_sets (user_id, exercise_id);

alter table public.profiles enable row level security;
alter table public.gyms enable row level security;
alter table public.machines enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own gyms" on public.gyms
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own machines" on public.machines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own exercises" on public.exercises
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own workouts" on public.workouts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sets" on public.workout_sets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Create a profile row automatically when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
