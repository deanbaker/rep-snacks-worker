# Rep Snacks: reminder Worker

The backend for [Rep Snacks](https://dean-baker.com/workouts/), which gives you a 5-minute workout at quarter past every hour.

The app itself (PWA, exercises, history) lives in the blog repo under `workouts/` and is served by
GitHub Pages at `dean-baker.com/workouts/`. This Worker only does the parts a static site can't:

- stores push subscriptions in KV (`/api/*`, CORS-limited to `ALLOWED_ORIGINS`)
- runs a cron every 5 minutes and sends a Web Push when it's :15–:19 past a working hour in that
  device's timezone, or when a snooze comes due

Everything else (exercises, rotation, history) stays in the phone's localStorage. The Worker keeps
only the subscription, timezone, working hours, the next exercise's label, and when you last did
one (so it doesn't nag right after).

Web Push (VAPID and aes128gcm encryption) is implemented with WebCrypto in `src/webpush.js`, with no dependencies.
Requests to anything other than `/api/*` redirect to the app.

CORS only stops other websites, not scripts, so the API also limits what a direct caller can do:
writes are rate-limited per IP (20 a minute), a new device is only stored after a "Reminders on"
push to it succeeds (so made-up subscriptions are rejected), and there's a cap of 10 devices.

## Setup

```bash
npm run vapid                          # writes .dev.vars and vapid.secret.json (both gitignored)
wrangler deploy                        # provisions the KV namespace on first deploy
wrangler secret bulk vapid.secret.json # upload the VAPID keys
```

The front end has the Worker URL in `API_BASE` at the top of `workouts/app.js` in the blog repo.

Local dev: `npm run dev`, then `curl localhost:8787/__scheduled` to trigger the cron.

## Install on iPhone

Open `dean-baker.com/workouts/` in Safari → Share → **Add to Home Screen** → open it from the Home
Screen → Settings → **Turn on reminders**. iOS only allows web push from Home Screen apps (iOS 16.4+).
