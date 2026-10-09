# Gym Companion

Workout logger first, then macros, then a coach. See the design document for the full plan.

## Run it

```
npm install
npm run dev
```

Open http://localhost:3000. The workout screen runs on local state for now; saving to Supabase comes next.

## Status

- Clean look with light and dark themes (tokens in `src/app/globals.css`)
- lb/kg toggle and theme toggle, both remembered on the device
- Live workout screen with sets, reps, previous values, and a done toggle
- Phase 1 database schema with row-level security in `supabase/migrations/0001_phase1.sql`

## Not done yet

- Supabase connection and sign-in
- Gym and machine catalog, and the add-machine-by-photo flow
- Saving workouts, history, and progress charts
