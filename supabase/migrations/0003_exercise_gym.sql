-- Exercises can belong to one gym (machines, cables) or to every gym (free weights,
-- bodyweight). gym_id null means "available at every gym".
-- Existing exercises stay available everywhere.

alter table public.exercises
  add column if not exists gym_id uuid references public.gyms (id);

create index if not exists exercises_user_gym_idx on public.exercises (user_id, gym_id);
