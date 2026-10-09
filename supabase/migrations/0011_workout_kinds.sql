-- Workout types beyond lifting. Every workout and exercise has a kind, and a set can carry time,
-- distance and an effort rating. Existing rows become 'strength' (what they all were).

alter table public.workouts add column if not exists kind text not null default 'strength';
alter table public.exercises add column if not exists kind text not null default 'strength';
alter table public.workout_sets add column if not exists duration_s integer;
alter table public.workout_sets add column if not exists distance_m numeric(10, 2);
-- workout_sets.rpe already exists (effort, 1-10).

do $$ begin
  alter table public.workouts add constraint workouts_kind_check
    check (kind in ('strength', 'cardio', 'intervals', 'sport'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.exercises add constraint exercises_kind_check
    check (kind in ('strength', 'cardio', 'intervals', 'sport'));
exception when duplicate_object then null; end $$;
