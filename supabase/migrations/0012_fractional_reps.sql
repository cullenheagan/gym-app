-- Partial reps: reps can now be 8.25, 8.5, 8.75 and so on.
-- Existing whole-number reps keep their value (8 becomes 8.00).
alter table public.workout_sets alter column reps type numeric(5, 2);
