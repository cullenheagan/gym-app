-- My plan (HCI proof of concept): one saved plan per person. answers holds the questionnaire,
-- plan holds the generated week (days, exercises, sets and reps) including any swaps.
-- Retaking the questionnaire replaces this row; logged workouts are separate and never touched.
-- New table, so the grants are explicit (Supabase stops adding them automatically on Oct 30, 2026).
-- Guests can make a plan too; it is deleted with their account (on delete cascade).

create table public.plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) < 50000),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;

create policy "own plan" on public.plans for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.plans from anon, authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant all on public.plans to service_role;
