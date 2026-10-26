# Quarter Past

A 5-minute workout at quarter past every hour. A PWA you install to your phone's Home Screen,
plus a Cloudflare Worker that sends the hourly push.

- **On the device (localStorage):** exercises, rotation pointer, history, working hours.
- **On the Worker (KV):** just the push subscription, timezone, working hours, the next exercise's
  label, and when you last did one (so it doesn't nag right after).

Done advances the rotation. Skip keeps the same exercise for next time. Snooze re-sends in about 10 min.

## How reminders work

A cron runs every 5 minutes. For each subscription it checks the local time in that device's timezone
and sends a push if it's :15–:19 past an hour inside working hours on a selected day (or if a
snooze has come due). Web Push (VAPID and aes128gcm encryption) is implemented with WebCrypto in
`src/webpush.js`, with no dependencies.

## Setup

```bash
npm run vapid                          # writes .dev.vars and vapid.secret.json (both gitignored)
wrangler deploy                        # provisions the KV namespace on first deploy
wrangler secret bulk vapid.secret.json # upload the VAPID keys
```

Set `VAPID_SUBJECT` in `wrangler.jsonc` to your Worker URL (or a `mailto:`).

Local dev: `npm run dev`, then `curl localhost:8787/__scheduled` to trigger the cron.

## Install on iPhone

Open the Worker URL in Safari → Share → **Add to Home Screen** → open it from the Home Screen →
Settings → **Turn on reminders**. iOS only allows web push from Home Screen apps (iOS 16.4+).
