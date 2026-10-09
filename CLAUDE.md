# Gym app: working notes for Claude

- Next.js 15 + React 19 + Tailwind v4 + Supabase. Deployed on Vercel; every push to `main` redeploys.
- Commit and push straight to `main`. Write each commit message as a plain-English note on what changed and why.
- Commits are authored as Cullen Eagan (cullenheagan@gmail.com) with a `Co-Authored-By: Claude` trailer. Set this with `git config user.name/user.email` in the clone.
- Keep the history clean: one commit per finished feature or fix, not one per small edit. Batch related edits, typecheck, then commit once. Do not push half-done work or tiny follow-up commits; fold them in before committing.
- Ask Cullen before deciding anything about look, branding or wording: logo and icons, colors, fonts, names, layout changes, and similar. Show options first (images when it helps), and change nothing until he picks. Same for any other decision he would want a say in.
- For each change: add an entry to `CHANGELOG.md` and to the Changelog page in the Notion "Gym App" wiki. Update the Features and Database pages when they change.
- New database changes go in a new numbered file under `supabase/migrations/`. The Supabase connector is available (project `gym-app`): show the SQL, ask before anything that changes or deletes existing data, apply it with the connector, then run the security advisor. If the connector is not available, tell the user to run the file in the Supabase SQL Editor before using the feature.
- Weights are stored in kg and converted for display. Look: light/dark tokens in `src/app/globals.css`.
- Typecheck before pushing (`npx tsc --noEmit`).
