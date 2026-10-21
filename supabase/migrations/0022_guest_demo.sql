-- Guest demo: "Look around as a guest" signs in with a Supabase anonymous account (needs
-- Authentication > Allow anonymous sign-ins turned on) and fills it with about four weeks of
-- sample data, so a visitor can try the app without making an account.
--
-- * Each guest gets their own private account; row-level security is unchanged.
-- * seed_guest_data() runs as the signed-in guest (security invoker), so it can only write that
--   guest's own rows. It refuses non-guest accounts and does nothing if the guest already has data.
-- * Guests cannot upload photos (the photo policies below now refuse anonymous accounts).
-- * A daily job deletes guest accounts older than 7 days, with all their data.
-- No existing data is changed. No new tables, so no new grants are needed beyond the function.

create or replace function public.seed_guest_data(p_today date, p_offset_min int)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gym uuid;
  ex jsonb := '{}'::jsonb;
  w uuid;
  d int;
  pos int;
  n int;
  day date;
  t0 timestamptz;
  si int;
  e record;
  lb constant numeric := 0.45359237;
  plan jsonb := '{
    "Push Day": [["Bench Press",135,5,8],["Overhead Press",85,2.5,8],["Incline Dumbbell Press",50,2.5,10],["Triceps Pushdown",50,2.5,12]],
    "Pull Day": [["Barbell Row",115,5,8],["Lat Pulldown",120,5,10],["Seated Cable Row",110,5,10],["Dumbbell Curl",25,1.25,10]],
    "Leg Day":  [["Back Squat",185,10,5],["Romanian Deadlift",155,5,8],["Leg Press",270,20,10],["Leg Curl",90,5,12]]
  }'::jsonb;
  names text[] := array['Push Day', 'Pull Day', 'Leg Day'];
  item jsonb;
  foods jsonb := '{
    "Breakfast": [
      [["Oats","usda",80,"g",300,10,54,5],["Banana","usda",118,"g",105,1.3,27,0.4],["Greek yogurt, nonfat","usda",170,"g",100,17,6,0.7]],
      [["Eggs, scrambled","usda",150,"g",225,15,2,17],["Whole wheat toast","usda",64,"g",160,8,28,2],["Orange juice","usda",240,"ml",110,2,26,0.5]]
    ],
    "Lunch": [
      [["Chicken breast, grilled","usda",200,"g",330,62,0,7],["White rice, cooked","usda",200,"g",260,5,57,0.6],["Broccoli, steamed","usda",150,"g",50,4,10,0.6]],
      [["Turkey sandwich","manual",1,"serving",420,32,44,12],["Apple","usda",182,"g",95,0.5,25,0.3]]
    ],
    "Dinner": [
      [["Salmon, baked","usda",170,"g",350,38,0,21],["Sweet potato, baked","usda",200,"g",180,4,41,0.3],["Mixed salad","manual",100,"g",20,1,4,0.2]],
      [["Lean ground beef, cooked","usda",150,"g",320,38,0,18],["Pasta, cooked","usda",220,"g",290,11,57,2],["Marinara sauce","off",125,"g",70,2,11,2]]
    ],
    "Snacks": [
      [["Whey protein shake","manual",1,"scoop",120,24,3,1.5],["Peanut butter","usda",32,"g",190,7,7,16]],
      [["Whey protein shake","manual",1,"scoop",120,24,3,1.5],["Protein bar","off",60,"g",210,20,22,7]]
    ]
  }'::jsonb;
  meal text;
  f jsonb;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Sample data is only for guest accounts.' using errcode = '42501';
  end if;
  if exists (select 1 from workouts where user_id = uid) then
    return; -- already filled
  end if;
  if p_today is null or abs(p_today - current_date) > 2 or p_offset_min not between -900 and 900 then
    raise exception 'Bad date.' using errcode = '22023';
  end if;

  insert into gyms (user_id, name) values (uid, 'Campus Rec Center') returning id into gym;

  update profiles set
    display_name = 'Guest', unit = 'lb', default_gym_id = gym,
    target_kcal = 2600, target_protein_g = 180, target_carbs_g = 300, target_fat_g = 75,
    rest_kcal = 2300, rest_protein_g = 180, rest_carbs_g = 230, rest_fat_g = 75,
    height_cm = 178, weight_kg = 80.3, birth_year = 2004, sex = 'male',
    activity_level = 'moderate', nutrition_goal = 'maintain'
  where id = uid;

  -- Exercises: free weights work at any gym; machines and cables belong to the gym.
  for e in
    select * from (values
      ('Bench Press', 'free_weight', false), ('Overhead Press', 'free_weight', false),
      ('Incline Dumbbell Press', 'free_weight', false), ('Triceps Pushdown', 'cable', true),
      ('Barbell Row', 'free_weight', false), ('Lat Pulldown', 'cable', true),
      ('Seated Cable Row', 'cable', true), ('Dumbbell Curl', 'free_weight', false),
      ('Back Squat', 'free_weight', false), ('Romanian Deadlift', 'free_weight', false),
      ('Leg Press', 'plate_machine', true), ('Leg Curl', 'pin_machine', true)
    ) v(name, equip, at_gym)
  loop
    insert into exercises (user_id, name, equipment_type, kind, gym_id)
    values (uid, e.name, e.equip, 'strength', case when e.at_gym then gym end)
    returning id into w;
    ex := ex || jsonb_build_object(e.name, w);
  end loop;
  insert into exercises (user_id, name, equipment_type, kind) values (uid, 'Run', 'other', 'cardio') returning id into w;
  ex := ex || jsonb_build_object('Run', w);

  -- 27 days back to yesterday: Push, Pull, Legs, rest (a run on every other rest day).
  -- Yesterday was Pull Day, so "Next up" shows Leg Day.
  for d in reverse 27..1 loop
    pos := ((2 - d) % 4 + 4) % 4;
    n := (27 - d) / 4; -- sessions of this workout so far, for steady progress
    day := p_today - d;
    t0 := (day + time '17:30') + make_interval(mins => p_offset_min + (d % 3) * 20);
    if pos < 3 then
      insert into workouts (user_id, gym_id, name, kind, started_at, ended_at)
      values (uid, gym, names[pos + 1], 'strength', t0, t0 + make_interval(mins => 58 + (d % 4) * 4))
      returning id into w;
      si := 0;
      for item in select value from jsonb_array_elements(plan -> names[pos + 1]) loop
        for k in 0..2 loop
          insert into workout_sets (id, user_id, workout_id, exercise_id, set_index, set_type, weight_kg, reps, completed_at)
          values (
            gen_random_uuid(), uid, w, (ex ->> (item ->> 0))::uuid, si, 'working',
            round(((item ->> 1)::numeric + (item ->> 2)::numeric * n) * lb, 3),
            (item ->> 3)::int - case when k = 2 then 1 else 0 end,
            t0 + make_interval(mins => 4 + si * 4)
          );
          si := si + 1;
        end loop;
      end loop;
    elsif d % 8 = 3 then
      insert into workouts (user_id, gym_id, name, kind, started_at, ended_at)
      values (uid, null, 'Run', 'cardio', t0 - interval '10 hours', t0 - interval '10 hours' + interval '32 minutes')
      returning id into w;
      insert into workout_sets (id, user_id, workout_id, exercise_id, set_index, set_type, duration_s, distance_m, completed_at)
      values (gen_random_uuid(), uid, w, (ex ->> 'Run')::uuid, 0, 'working', 1860 - (27 - d) * 6, 5000, t0 - interval '9 hours 28 minutes');
    end if;
  end loop;

  -- Food: the last 13 days in full, and today's breakfast and lunch so the Today card has progress.
  for d in reverse 13..0 loop
    day := p_today - d;
    foreach meal in array array['Breakfast', 'Lunch', 'Dinner', 'Snacks'] loop
      exit when d = 0 and meal = 'Dinner';
      for f in select value from jsonb_array_elements(foods -> meal -> (d % 2)) loop
        insert into food_entries (id, user_id, eaten_on, meal, name, source, amount, unit, kcal, protein_g, carbs_g, fat_g)
        values (gen_random_uuid(), uid, day, meal, f ->> 0, f ->> 1, (f ->> 2)::numeric, f ->> 3,
                (f ->> 4)::numeric, (f ->> 5)::numeric, (f ->> 6)::numeric, (f ->> 7)::numeric);
      end loop;
    end loop;
  end loop;

  -- Bodyweight: a slow cut from about 81.6 kg (180 lb) with day-to-day noise; today left for the guest to log.
  for d in reverse 28..1 loop
    insert into body_weights (user_id, measured_on, weight_kg)
    values (uid, p_today - d, round((80.3 + 0.047 * d + 0.3 * sin(d * 1.7))::numeric, 2));
  end loop;

  insert into saved_foods (id, user_id, name, amount, unit, kcal, protein_g, carbs_g, fat_g) values
    (gen_random_uuid(), uid, 'Whey protein shake', 1, 'scoop', 120, 24, 3, 1.5),
    (gen_random_uuid(), uid, 'Overnight oats', 1, 'jar', 380, 22, 52, 9);
  insert into saved_meals (id, user_id, name, items) values (gen_random_uuid(), uid, 'Chicken rice bowl', '[
    {"name":"Chicken breast, grilled","brand":null,"amount":200,"unit":"g","kcal":330,"protein_g":62,"carbs_g":0,"fat_g":7},
    {"name":"White rice, cooked","brand":null,"amount":200,"unit":"g","kcal":260,"protein_g":5,"carbs_g":57,"fat_g":0.6},
    {"name":"Broccoli, steamed","brand":null,"amount":150,"unit":"g","kcal":50,"protein_g":4,"carbs_g":10,"fat_g":0.6}
  ]'::jsonb);
end;
$$;

revoke execute on function public.seed_guest_data(date, int) from public, anon;
grant execute on function public.seed_guest_data(date, int) to authenticated;

-- Guests cannot upload or replace photos.
drop policy if exists "own photos insert" on storage.objects;
create policy "own photos insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'equipment-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
drop policy if exists "own photos update" on storage.objects;
create policy "own photos update" on storage.objects for update to authenticated
  using (
    bucket_id = 'equipment-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

-- Delete guest accounts older than 7 days, every day at 08:17 UTC. Sets go first because a set
-- blocks its exercise from being deleted; everything else follows the account (on delete cascade).
create or replace function public.delete_old_guests() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.workout_sets s using auth.users u
    where s.user_id = u.id and u.is_anonymous and u.created_at < now() - interval '7 days';
  delete from auth.users where is_anonymous and created_at < now() - interval '7 days';
end;
$$;
revoke execute on function public.delete_old_guests() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('delete-old-guests', '17 8 * * *', 'select public.delete_old_guests()');
