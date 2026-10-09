# Changelog

Newest first. Each entry says what changed and why. Mirrored in the Notion "Gym App" wiki.

## 2026-10-09
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
