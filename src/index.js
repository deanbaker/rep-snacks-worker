import { sendPush } from "./webpush.js";

// Only accept subscriptions from the real browser push services.
const PUSH_HOSTS = [
  ".push.apple.com",
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
];

// CORS only stops other websites; scripts can call the API directly. These limit what they can do.
const MAX_SUBS = 10; // it's a personal app: a few devices at most
const RATE_LIMITED = ["PUT /api/sub", "DELETE /api/sub", "POST /api/snooze", "POST /api/test"];

const SNOOZE_MAX_MIN = 60;
const RECENT_DONE_MS = 30 * 60 * 1000; // don't nag if you just did one
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "sub:" + [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => url.hostname === h.replace(/^\./, "") || url.hostname.endsWith(h));
  } catch {
    return false;
  }
}

function cleanPrefs(p = {}) {
  const hour = (h, d) => (Number.isInteger(h) && h >= 0 && h <= 24 ? h : d);
  let tz = "UTC";
  try { tz = new Intl.DateTimeFormat("en-US", { timeZone: p.tz }).resolvedOptions().timeZone; } catch {}
  return {
    tz,
    startHour: hour(p.startHour, 9),
    endHour: hour(p.endHour, 17),
    days: Array.isArray(p.days) ? p.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
  };
}

function cleanNext(n) {
  if (!n || typeof n.name !== "string") return null;
  return { name: n.name.slice(0, 60), detail: String(n.detail ?? "").slice(0, 80) };
}

function localTime(ms, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" })
      .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute), day: WEEKDAYS.indexOf(parts.weekday) };
}

function reminderPayload(rec) {
  const n = rec.next;
  return {
    title: "Time to move 💪",
    body: n ? `${n.name}${n.detail ? " · " + n.detail : ""}` : "5 minutes. Up you get.",
  };
}

// Adding a device, or changing a device's keys, needs the ENROL_CODE secret. Hashing both sides
// first gives equal-length inputs for the constant-time compare.
async function enrolOk(code, env) {
  if (!env.ENROL_CODE || typeof code !== "string" || !code) return false;
  const hash = async (s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return crypto.subtle.timingSafeEqual(await hash(code), await hash(env.ENROL_CODE));
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handleApi(request, env, url) {
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/vapid") return json({ publicKey: env.VAPID_PUBLIC_KEY });
  if (!RATE_LIMITED.includes(route)) return json({ error: "not found" }, 404);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json({ error: "too many requests" }, 429);

  const body = await readBody(request);
  const endpoint = body.subscription?.endpoint ?? body.endpoint;
  if (!validEndpoint(endpoint)) return json({ error: "invalid endpoint" }, 400);
  const key = await keyFor(endpoint);

  switch (route) {
    case "PUT /api/sub": {
      const s = body.subscription;
      if (!s?.keys?.p256dh || !s?.keys?.auth) return json({ error: "invalid subscription" }, 400);
      const prev = await env.SUBS.get(key, "json");
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
      const sameKeys = prev?.subscription?.keys?.p256dh === s.keys.p256dh && prev?.subscription?.keys?.auth === s.keys.auth;
      if (!sameKeys && !(await enrolOk(body.enrolCode, env))) return json({ error: "wrong enrolment code" }, 403);
      if (!prev) {
        // New device: there's room for it, and it's a real subscription (made-up endpoints and keys fail).
        if ((await env.SUBS.list({ prefix: "sub:", limit: MAX_SUBS })).keys.length >= MAX_SUBS) return json({ error: "subscription limit reached" }, 403);
        let status = 0;
        try { status = await sendPush(subscription, { title: "Reminders on ✅", body: "See you at quarter past." }, env); } catch {}
        if (status < 200 || status >= 300) return json({ error: "subscription check failed", status }, 400);
      }
      const rec = {
        subscription,
        prefs: cleanPrefs(body.prefs),
        next: cleanNext(body.next),
        lastDoneAt: Number(body.lastDoneAt) || null,
        snoozeUntil: body.clearSnooze ? null : prev?.snoozeUntil ?? null,
      };
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true });
    }
    case "DELETE /api/sub":
      await env.SUBS.delete(key);
      return json({ ok: true });
    case "POST /api/snooze": {
      const rec = await env.SUBS.get(key, "json");
      if (!rec) return json({ error: "not subscribed" }, 404);
      const minutes = Math.min(Math.max(Number(body.minutes) || 10, 1), SNOOZE_MAX_MIN);
      rec.snoozeUntil = Date.now() + minutes * 60 * 1000;
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true, snoozeUntil: rec.snoozeUntil });
    }
    case "POST /api/test": {
      const rec = await env.SUBS.get(key, "json");
      if (!rec) return json({ error: "not subscribed" }, 404);
      const status = await sendPush(rec.subscription, reminderPayload(rec), env);
      return json({ ok: status < 300, status });
    }
  }
  return json({ error: "not found" }, 404);
}

function isDue(rec, now) {
  if (rec.snoozeUntil) return now >= rec.snoozeUntil - 30_000;
  const { hour, minute, day } = localTime(now, rec.prefs.tz);
  if (minute < 15 || minute >= 20) return false; // cron runs every 5 min, so this matches once per hour
  if (!rec.prefs.days.includes(day)) return false;
  if (hour < rec.prefs.startHour || hour >= rec.prefs.endHour) return false;
  return !(rec.lastDoneAt && now - rec.lastDoneAt < RECENT_DONE_MS);
}

async function runReminders(env, now) {
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    await Promise.all(page.keys.map(async ({ name }) => {
      const rec = await env.SUBS.get(name, "json");
      if (!rec || !isDue(rec, now)) return;
      const status = await sendPush(rec.subscription, reminderPayload(rec), env);
      if (status === 404 || status === 410) return env.SUBS.delete(name);
      if (rec.snoozeUntil) {
        rec.snoozeUntil = null;
        await env.SUBS.put(name, JSON.stringify(rec));
      }
    }));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

// The app is served from the blog (GitHub Pages), so the API is called cross-origin.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !env.ALLOWED_ORIGINS.split(",").includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return Response.redirect(env.APP_URL, 302);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const res = await handleApi(request, env, url);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, event.scheduledTime));
  },
};
