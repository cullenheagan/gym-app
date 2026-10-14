-- Phase 3: bodyweight log. One weight per person per day (a second save for the same day replaces
-- it). Weights are kept in kilograms like everything else. Everything here is new; nothing
-- existing is changed or removed.
create table public.body_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  measured_on date not null,
  weight_kg numeric(6, 2) not null check (weight_kg > 0 and weight_kg < 700),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);

alter table public.body_weights enable row level security;
create policy "own body weights" on public.body_weights for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.body_weights from anon, authenticated;
grant select, insert, update, delete on public.body_weights to authenticated;
