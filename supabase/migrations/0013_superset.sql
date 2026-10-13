-- Supersets: two exercises done back to back share one superset_id on their sets.
-- Null means a normal set. Existing rows are untouched.
alter table public.workout_sets add column superset_id uuid;
