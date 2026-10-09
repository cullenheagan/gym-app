# Gym app: working notes for Claude

- Next.js 15 + React 19 + Tailwind v4 + Supabase. Deployed on Vercel; every push to `main` redeploys.
- Commit and push straight to `main`. Write each commit message as a plain-English note on what changed and why.
- For each change: add an entry to `CHANGELOG.md` and to the Changelog page in the Notion "Gym App" wiki. Update the Features and Database pages when they change.
- New database changes go in a new numbered file under `supabase/migrations/`. Tell the user to run it in the Supabase SQL Editor before using the feature.
- Weights are stored in kg and converted for display. Look: light/dark tokens in `src/app/globals.css`.
- Typecheck before pushing (`npx tsc --noEmit`).
