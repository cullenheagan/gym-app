-- Phase 2: nutrition tracking. Everything here is new; nothing existing is changed or removed.

-- Daily targets, meal names and the stats used to suggest targets live on the profile.
alter table public.profiles
  add column target_kcal integer,
  add column target_protein_g numeric(6, 1),
  add column target_carbs_g numeric(6, 1),
  add column target_fat_g numeric(6, 1),
  add column meal_names text[] not null default array['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
  add column height_cm numeric(5, 1),
  add column weight_kg numeric(5, 1),
  add column birth_year integer,
  add column sex text check (sex in ('male', 'female')),
  add column activity_level text check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  add column nutrition_goal text check (nutrition_goal in ('lose', 'maintain', 'gain'));

-- One row per food eaten. The macros are saved as the totals for the amount eaten, so a later
-- change to a food's database entry never rewrites your history. id is made on the phone so a
-- retried save never duplicates.
create table public.food_entries (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  eaten_on date not null,
  meal text not null,
  name text not null,
  brand text,
  source text not null default 'manual' check (source in ('usda', 'off', 'manual', 'saved')),
  source_id text,
  amount numeric(8, 2),
  unit text,
  kcal numeric(7, 1) not null default 0 check (kcal >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  created_at timestamptz not null default now()
);

create index food_entries_day_idx on public.food_entries (user_id, eaten_on);

alter table public.food_entries enable row level security;
create policy "own food entries" on public.food_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.food_entries from anon, authenticated;
grant select, insert, update, delete on public.food_entries to authenticated;
