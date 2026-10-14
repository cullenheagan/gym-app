-- Phase 2 step 2: saved foods and saved meals. Everything here is new; nothing existing is changed or removed.

-- A food you saved, kept as the totals for the amount you saved it at (for example 200 g of
-- chicken breast), so adding it again is one tap and later database changes never alter it.
create table public.saved_foods (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  brand text,
  amount numeric(8, 2),
  unit text,
  kcal numeric(7, 1) not null default 0 check (kcal >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  created_at timestamptz not null default now()
);

create index saved_foods_user_idx on public.saved_foods (user_id, created_at desc);

-- A meal you saved: a name and its foods (name, brand, amount, unit and macro totals each).
create table public.saved_meals (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40),
  created_at timestamptz not null default now()
);

create index saved_meals_user_idx on public.saved_meals (user_id, created_at desc);

alter table public.saved_foods enable row level security;
alter table public.saved_meals enable row level security;

create policy "own saved foods" on public.saved_foods for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved meals" on public.saved_meals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.saved_foods from anon, authenticated;
revoke all on public.saved_meals from anon, authenticated;
grant select, insert, update, delete on public.saved_foods to authenticated;
grant select, insert, update, delete on public.saved_meals to authenticated;
