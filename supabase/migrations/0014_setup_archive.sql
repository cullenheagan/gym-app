-- Removing a bench/seat setup only hides it, so old workouts still show its name and pin.
alter table public.exercise_setups add column archived_at timestamptz;
