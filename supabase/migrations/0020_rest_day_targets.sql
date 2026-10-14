-- Phase 3: separate nutrition targets for rest days. The existing target_* columns become the
-- training-day targets. Each rest-day column is optional; empty means "use the training-day
-- number". Everything here is new; nothing existing is changed or removed.
alter table public.profiles
  add column rest_kcal integer,
  add column rest_protein_g numeric(6, 1),
  add column rest_carbs_g numeric(6, 1),
  add column rest_fat_g numeric(6, 1);
