-- Single-arm exercises: remember which exercises are done one side at a time,
-- and keep the right-side reps next to the existing reps column (which holds the left side).
alter table public.exercises add column single_arm boolean not null default false;
alter table public.workout_sets add column reps_right numeric(5, 2);
