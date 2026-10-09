-- Machines (exercises) can be removed from your lists without losing any history.
-- A removed one keeps its logged sets, so History, Progress and the CSV export still show it.

alter table public.exercises add column if not exists archived_at timestamptz;
