# Changelog

Newest first. Each entry says what changed and why. Mirrored in the Notion "Gym App" wiki.

## 2026-10-09
- Workout naming: the log screen now has a pencil button next to the workout name and a row of tappable name suggestions (up to four names you have used before, most used first, then Push Day, Pull Day, Leg Day, Upper, Lower, Full Body, Arms). The row shows until you add the first exercise; the name stays editable.
- Warm-up sets: tap a set's number to switch it between a working set and a warm-up (shown as W on a tinted row; working sets are numbered on their own). Warm-ups are saved but left out of Total weight lifted, History totals and set counts, the Previous column, Progress and suggestions. History marks them with W. No database change (uses the existing set type).
- Weight suggestions: when you add an exercise (or start from a past workout) a Try chip suggests your next weight from the last session. If every set at your top weight reached the rep goal (8, or the reps of a fixed scheme like 5x5), it suggests a small step up (about 2.5%, rounded to 5 lb or 2.5 kg); if some sets fell short it suggests staying at that weight. Tap the chip to fill your unfinished working sets.
- Profile: a person button in the top bar opens a Profile screen where you set your name. Home then greets you with "Hi, <name>" (until a name is set it shows Home with an Add your name link). The name is stored on your profile (migration 0008, adds an optional `display_name` column; existing data untouched) and kept on the phone for offline.
- New Home screen, now the first tab (Home, History, Gyms, Progress). A big Start workout button opens the log screen; if a workout is already in progress it says Resume workout with the elapsed time. Below it, shortcuts to start from a past workout (one per workout name, most-done first, copying your last time) and this week's workouts and total lifted. The log screen has a back link to Home, and finishing or discarding a workout returns to Home. No database change.
- New Progress tab: one chart per exercise from your logged working sets (warm-ups skipped). Pick Est. 1RM (default), Top weight or Volume, and a range of 1M, 3M, 6M or All. Shows Best, Latest and Change, marks new personal bests, and lists recent sessions. Tap or hover the chart to read any session. Works in lb or kg and keeps a saved copy for offline. No database change.
- Database security: blocked the sign-up function `handle_new_user()` from being called through the public API (migration 0007). Sign-up still creates your profile as before. The Supabase security check now only reports leaked-password protection, which is a dashboard setting.
- History filters: pick a gym and/or a workout type (the workout name, like "Push Day"; spellings that only differ by capital letters or spaces count as one). Shows how many match, with Clear filters. History now loads up to 200 workouts.
- New Gyms tab: every gym with its photo, the machines saved at it and how many workouts were logged there. Add a gym, add or change its photo, and remove it from the gym dropdown. Removing only hides it (workouts and machines are kept), and removed gyms can be restored. Needs migration 0006; until it is run, the rest of the app still works.
- New app icon: a bold G with a loaded barbell underneath (chosen by Cullen from several options), used for the home screen, browser tab and install icon.
- Offline mode: finished workouts are saved on the phone first and sync to the database when there is signal (safe to retry, no duplicates). A banner shows when you are offline or workouts are waiting, with a Sync now button. Gyms, exercises, last-time sets, setups and history are kept on the phone so they still show offline. Creating gyms, exercises, setups and photos still needs signal.
- The app opens with no signal (service worker) and can be installed to the home screen with a proper icon and name (manifest).
- Export all data (CSV) button at the bottom of History: every set with date, gym, exercise, bench setup, weight in lb and kg, and reps.
- Repo connected to Claude: changes are now committed and pushed straight to `main` with a note.
- Deployed to Vercel from GitHub; works on a phone.
- Repeat a past workout from History; the bench/seat setup used last time is remembered and shown in History.
- Photos for existing machines; bench/seat setups with photo and pin position (migration 0005).
- Machine photos when creating an exercise, plus the camera button (migration 0004).
- Exercise order and timing in History, a live workout clock, and a gym-scoped exercise picker that fixes missing "Previous" data (migration 0003).
- Fixed table permissions (migration 0002).
- First version: sign-in, logger, history, gyms, themes, unit toggle (migration 0001).
