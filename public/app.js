import { DEFAULT_EXERCISES } from "./exercises.js";

const STORE_KEY = "qp:v1";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORIES = ["legs", "push", "core", "stretch", "other"];

// ---------- state ----------

function defaultState() {
  return {
    exercises: DEFAULT_EXERCISES.map((e) => ({ ...e, enabled: true })),
    currentId: DEFAULT_EXERCISES[0].id,
    log: [], // { id, name, at, outcome: "done" | "skipped" | "snoozed" }
    prefs: { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.exercises) return { ...defaultState(), ...saved };
  } catch {}
  return defaultState();
}

let state = load();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

const enabled = () => state.exercises.filter((e) => e.enabled);

function current() {
  const list = enabled();
  return list.find((e) => e.id === state.currentId) ?? list[0] ?? null;
}

function upNext() {
  const list = enabled();
  const cur = current();
  if (!cur || list.length < 2) return null;
  return list[(list.indexOf(cur) + 1) % list.length];
}

// ---------- rotation actions ----------

function record(outcome) {
  const ex = current();
  if (!ex) return;
  state.log.push({ id: ex.id, name: ex.name, at: Date.now(), outcome });
  if (outcome === "done") state.currentId = upNext()?.id ?? ex.id;
  else state.currentId = ex.id; // skip/snooze: same exercise next time
  save();
}

async function markDone() {
  stopTimer();
  record("done");
  toast("Nice work 💪");
  render();
  await syncServer({ clearSnooze: true });
}

async function markSkipped() {
  stopTimer();
  record("skipped");
  toast("Skipped. Same one next time.");
  render();
  await syncServer({ clearSnooze: true });
}

async function snooze() {
  const sub = await getSubscription();
  if (!sub) return;
  record("snoozed");
  const res = await api("POST", "/api/snooze", { endpoint: sub.endpoint, minutes: 10 });
  toast(res?.ok ? "Snoozed ~10 min" : "Couldn't snooze");
  render();
}

// ---------- push ----------

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let swReg = null;
let subscribed = false;

async function api(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function getSubscription() {
  return swReg ? swReg.pushManager.getSubscription() : null;
}

function b64urlToBytes(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function lastDoneAt() {
  for (let i = state.log.length - 1; i >= 0; i--) if (state.log[i].outcome === "done") return state.log[i].at;
  return null;
}

// The server only knows enough to send the reminder: schedule, timezone, and the next exercise's label.
async function syncServer(extra = {}) {
  const sub = await getSubscription();
  if (!sub) return;
  const ex = current();
  await api("PUT", "/api/sub", {
    subscription: sub.toJSON(),
    prefs: { ...state.prefs, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    next: ex ? { name: ex.name, detail: ex.detail } : null,
    lastDoneAt: lastDoneAt(),
    ...extra,
  });
}

async function enablePush() {
  if (!swReg) return toast("Reminders need the app's service worker, which didn't load");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("Notifications were not allowed");
  const { publicKey } = (await api("GET", "/api/vapid")) ?? {};
  if (!publicKey) return toast("Couldn't reach the server");
  try {
    await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  } catch (err) {
    return toast("Subscribe failed: " + err.message);
  }
  subscribed = true;
  await syncServer();
  toast("Reminders on");
  render();
}

async function disablePush() {
  const sub = await getSubscription();
  if (sub) {
    await api("DELETE", "/api/sub", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  subscribed = false;
  toast("Reminders off");
  render();
}

async function testPush() {
  const sub = await getSubscription();
  if (!sub) return;
  await syncServer();
  const res = await api("POST", "/api/test", { endpoint: sub.endpoint });
  toast(res?.ok ? "Test sent" : `Test failed (${res?.status ?? "network"})`);
}

// ---------- timer ----------

let timer = null; // { phase, round, endsAt, remaining, running }
let tick = null;
let audio = null;

function beep(freq = 880, ms = 180) {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch {}
}

function startTimer() {
  const t = current()?.timer;
  if (!t) return;
  if (!timer || timer.finished) timer = { phase: "work", round: 1, remaining: t.work, running: false };
  timer.running = true;
  timer.endsAt = Date.now() + timer.remaining * 1000;
  beep(660);
  clearInterval(tick);
  tick = setInterval(stepTimer, 200);
  renderTimer();
}

function pauseTimer() {
  if (!timer?.running) return;
  timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  timer.running = false;
  clearInterval(tick);
  renderTimer();
}

function stopTimer() {
  clearInterval(tick);
  timer = null;
}

function stepTimer() {
  const t = current()?.timer;
  if (!timer || !t) return stopTimer();
  timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
  if (timer.remaining === 0) {
    if (timer.phase === "work" && timer.round < t.rounds && t.rest > 0) {
      Object.assign(timer, { phase: "rest", remaining: t.rest, endsAt: Date.now() + t.rest * 1000 });
      beep(440, 300);
    } else if (timer.round < t.rounds) {
      Object.assign(timer, { phase: "work", round: timer.round + 1, remaining: t.work, endsAt: Date.now() + t.work * 1000 });
      beep(880);
    } else {
      clearInterval(tick);
      Object.assign(timer, { running: false, finished: true });
      beep(880, 150); setTimeout(() => beep(1100, 300), 200);
    }
  }
  renderTimer();
}

const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------- schedule helpers ----------

function nextReminder(from = new Date()) {
  const { startHour, endHour, days } = state.prefs;
  if (!days.length || startHour >= endHour) return null;
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    const cand = new Date(d);
    cand.setHours(d.getHours() + i, 15);
    if (cand <= from) continue;
    if (days.includes(cand.getDay()) && cand.getHours() >= startHour && cand.getHours() < endHour) return cand;
  }
  return null;
}

const dayKey = (ms) => new Date(ms).toLocaleDateString("en-CA");
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function doneByDay() {
  const map = {};
  for (const l of state.log) if (l.outcome === "done") map[dayKey(l.at)] = (map[dayKey(l.at)] ?? 0) + 1;
  return map;
}

function streak() {
  const map = doneByDay();
  const d = new Date();
  let n = 0;
  if (!map[dayKey(d)]) d.setDate(d.getDate() - 1); // today not started yet doesn't break it
  while (true) {
    if (map[dayKey(d)]) n++;
    else if (state.prefs.days.includes(d.getDay())) break; // only workdays count against you
    d.setDate(d.getDate() - 1);
    if (n > 3650) break;
  }
  return n;
}

// ---------- rendering ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (sel) => document.querySelector(sel);
let view = "now";
let editingId = null;
let addingId = null; // a just-added exercise that hasn't been saved yet

function render() {
  const next = nextReminder();
  $("#next-reminder").textContent = next
    ? `Next reminder ${next.toDateString() === new Date().toDateString() ? "" : DAY_NAMES[next.getDay()] + " "}${fmtTime(next)}`
    : "No reminders scheduled";
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.view === view);
  for (const v of ["now", "history", "settings"]) $(`#view-${v}`).hidden = v !== view;
  ({ now: renderNow, history: renderHistory, settings: renderSettings })[view]();
}

function renderNow() {
  const ex = current();
  const el = $("#view-now");
  if (!ex) {
    el.innerHTML = `<div class="card empty"><p>No exercises enabled.</p><button class="btn" data-go="settings">Add some</button></div>`;
    return;
  }
  const todayDone = doneByDay()[dayKey(Date.now())] ?? 0;
  const nxt = upNext();
  el.innerHTML = `
    <div class="card exercise">
      <span class="chip chip-${esc(ex.category)}">${esc(ex.category)}</span>
      <h2>${esc(ex.name)}</h2>
      <p class="detail">${esc(ex.detail)}</p>
      ${ex.cue ? `<p class="cue">${esc(ex.cue)}</p>` : ""}
      ${ex.timer ? `<div id="timer" class="timer"></div>` : ""}
    </div>
    <div class="actions">
      <button class="btn primary big" data-act="done">Done</button>
      <div class="row">
        <button class="btn" data-act="skip">Skip this hour</button>
        ${subscribed ? `<button class="btn" data-act="snooze">Snooze 10m</button>` : ""}
      </div>
    </div>
    <div class="today">
      <div><strong>${todayDone}</strong> done today</div>
      <div><strong>${streak()}</strong> day streak</div>
    </div>
    ${nxt ? `<p class="muted center">Up next: ${esc(nxt.name)}</p>` : ""}
    ${!subscribed ? `<p class="muted center"><button class="link" data-go="settings">Turn on reminders</button></p>` : ""}
  `;
  renderTimer();
}

function renderTimer() {
  const el = $("#timer");
  const t = current()?.timer;
  if (!el || !t) return;
  const s = timer ?? { phase: "work", round: 1, remaining: t.work, running: false };
  const label = s.finished ? "Finished" : s.phase === "rest" ? "Rest" : "Go";
  el.className = `timer ${s.phase}${s.finished ? " finished" : ""}`;
  el.innerHTML = `
    <div class="timer-phase">${label}${t.rounds > 1 ? ` · round ${s.round}/${t.rounds}` : ""}</div>
    <div class="timer-time">${fmtSecs(s.finished ? 0 : s.remaining)}</div>
    ${s.finished
      ? `<button class="btn" data-act="timer-reset">Again</button>`
      : `<button class="btn" data-act="${s.running ? "timer-pause" : "timer-start"}">${s.running ? "Pause" : timer ? "Resume" : "Start timer"}</button>`}
  `;
}

function renderHistory() {
  const el = $("#view-history");
  const map = doneByDay();
  const days = [];
  // Start on a Monday so the 7-column grid lines up with weekdays.
  const back = 27 + ((new Date().getDay() + 6 - 27 % 7 + 7) % 7);
  for (let i = back; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ d, n: map[dayKey(d)] ?? 0 });
  }
  const max = Math.max(1, ...days.map((x) => x.n));
  const recent = state.log.slice(-60).reverse();
  let lastDay = null;
  const rows = recent.map((l) => {
    const dk = dayKey(l.at);
    const header = dk !== lastDay ? `<li class="day">${new Date(l.at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</li>` : "";
    lastDay = dk;
    return `${header}<li class="${l.outcome}"><span>${esc(l.name)}</span><span class="muted">${l.outcome} · ${fmtTime(new Date(l.at))}</span></li>`;
  }).join("");
  el.innerHTML = `
    <div class="card">
      <h3>Last 4 weeks</h3>
      <div class="heat">${days.map(({ d, n }) =>
        `<div class="cell${n / max > 0.5 ? " hi" : ""}" title="${d.toDateString()}: ${n}" style="--a:${n ? 0.25 + 0.75 * (n / max) : 0}"><span>${n || ""}</span></div>`).join("")}</div>
      <div class="today">
        <div><strong>${state.log.filter((l) => l.outcome === "done").length}</strong> total done</div>
        <div><strong>${streak()}</strong> day streak</div>
      </div>
    </div>
    <div class="card">
      <h3>Recent</h3>
      ${rows ? `<ul class="log">${rows}</ul>` : `<p class="muted">Nothing yet. Your first one's waiting on the Now tab.</p>`}
    </div>
  `;
}

function hourOptions(selected) {
  let out = "";
  for (let h = 0; h <= 24; h++) out += `<option value="${h}" ${h === selected ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`;
  return out;
}

function renderPushCard() {
  if (!pushSupported && isIOS && !isStandalone) {
    return `<p>To get reminders on iPhone, add this app to your Home Screen first:</p>
      <ol class="steps"><li>Tap the <strong>Share</strong> button in Safari</li><li>Choose <strong>Add to Home Screen</strong></li><li>Open Quarter Past from the Home Screen and come back here</li></ol>`;
  }
  if (!pushSupported) return `<p class="muted">This browser doesn't support push notifications.</p>`;
  if (Notification.permission === "denied") return `<p>Notifications are blocked. Re-enable them for this app in system settings.</p>`;
  if (!subscribed) return `<p>Get a notification at quarter past each hour during your working hours.</p><button class="btn primary" data-act="push-on">Turn on reminders</button>`;
  return `<p>Reminders are <strong>on</strong> for this device.</p>
    <div class="row"><button class="btn" data-act="push-test">Send a test</button><button class="btn" data-act="push-off">Turn off</button></div>`;
}

function renderExerciseRow(ex, i, n) {
  if (editingId === ex.id) {
    const t = ex.timer ?? {};
    return `<li class="edit"><form data-edit="${esc(ex.id)}">
      <label>Name <input name="name" value="${esc(ex.name)}" required></label>
      <label>Target <input name="detail" value="${esc(ex.detail)}" placeholder="3 × 12"></label>
      <label>Cue <input name="cue" value="${esc(ex.cue)}"></label>
      <label>Category <select name="category">${CATEGORIES.map((c) => `<option ${c === ex.category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <fieldset><legend>Timer (optional, seconds)</legend>
        <label>Work <input name="work" type="number" min="0" value="${t.work ?? ""}"></label>
        <label>Rest <input name="rest" type="number" min="0" value="${t.rest ?? ""}"></label>
        <label>Rounds <input name="rounds" type="number" min="0" value="${t.rounds ?? ""}"></label>
      </fieldset>
      <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="edit-cancel">Cancel</button><button class="btn danger" type="button" data-act="ex-delete" data-id="${esc(ex.id)}">Delete</button></div>
    </form></li>`;
  }
  return `<li class="${ex.enabled ? "" : "off"}">
    <label class="toggle"><input type="checkbox" data-act="ex-toggle" data-id="${esc(ex.id)}" aria-label="Include ${esc(ex.name)}" ${ex.enabled ? "checked" : ""}></label>
    <button class="ex-name" data-act="ex-edit" data-id="${esc(ex.id)}"><span>${esc(ex.name)}</span><small class="muted">${esc(ex.detail)}${ex.id === state.currentId ? " · current" : ""}</small></button>
    <span class="order">
      <button aria-label="Move up" data-act="ex-up" data-id="${esc(ex.id)}" ${i === 0 ? "disabled" : ""}>↑</button>
      <button aria-label="Move down" data-act="ex-down" data-id="${esc(ex.id)}" ${i === n - 1 ? "disabled" : ""}>↓</button>
    </span>
  </li>`;
}

function renderSettings() {
  const { startHour, endHour, days } = state.prefs;
  const n = state.exercises.length;
  $("#view-settings").innerHTML = `
    <div class="card"><h3>Reminders</h3>${renderPushCard()}</div>
    <div class="card">
      <h3>Working hours</h3>
      <div class="row">
        <label>From <select data-pref="startHour">${hourOptions(startHour)}</select></label>
        <label>Until <select data-pref="endHour">${hourOptions(endHour)}</select></label>
      </div>
      <p class="muted small">${startHour < endHour
        ? `Reminders at :15 past each hour from ${String(startHour).padStart(2, "0")}:15 to ${String(endHour - 1).padStart(2, "0")}:15.`
        : `No reminders: “Until” needs to be later than “From”.`}</p>
      <div class="days">${DAY_NAMES.map((d, i) => `<button class="day-chip ${days.includes(i) ? "on" : ""}" data-act="day" data-day="${i}" aria-label="${d}" title="${d}">${d[0]}</button>`).join("")}</div>
    </div>
    <div class="card">
      <h3>Exercises</h3>
      <p class="muted small">They rotate in this order. Tap one to edit it.</p>
      <ul class="exlist">${state.exercises.map((ex, i) => renderExerciseRow(ex, i, n)).join("")}</ul>
      <button class="btn" data-act="ex-add">+ Add exercise</button>
    </div>
    <div class="card">
      <h3>Data</h3>
      <p class="muted small">Everything lives on this device. Export it now and then as a backup.</p>
      <div class="row">
        <button class="btn" data-act="export">Export</button>
        <label class="btn">Import<input type="file" accept="application/json" data-act="import" hidden></label>
        <button class="btn danger" data-act="reset">Reset</button>
      </div>
    </div>
  `;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// ---------- events ----------

function moveExercise(id, delta) {
  const i = state.exercises.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.exercises.length) return;
  [state.exercises[i], state.exercises[j]] = [state.exercises[j], state.exercises[i]];
}

const settingsChanged = () => { save(); render(); syncServer(); };

document.addEventListener("click", async (e) => {
  const go = e.target.closest("[data-go]");
  const tab = e.target.closest(".tabs button");
  if (go || tab) {
    view = (go ?? tab).dataset.view ?? go.dataset.go;
    editingId = addingId = null;
    render();
    scrollTo(0, 0);
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.matches("input")) return;
  const id = btn.dataset.id;
  switch (btn.dataset.act) {
    case "done": return markDone();
    case "skip": return markSkipped();
    case "snooze": return snooze();
    case "timer-start": return startTimer();
    case "timer-pause": return pauseTimer();
    case "timer-reset": timer = null; return startTimer();
    case "push-on": return enablePush();
    case "push-off": return disablePush();
    case "push-test": return testPush();
    case "day": {
      const d = Number(btn.dataset.day);
      const days = new Set(state.prefs.days);
      days.has(d) ? days.delete(d) : days.add(d);
      state.prefs.days = [...days].sort();
      return settingsChanged();
    }
    case "ex-edit": editingId = id; addingId = null; return render();
    case "edit-cancel": {
      if (addingId === editingId) { state.exercises = state.exercises.filter((x) => x.id !== addingId); save(); }
      editingId = addingId = null;
      return render();
    }
    case "ex-up": moveExercise(id, -1); return settingsChanged();
    case "ex-down": moveExercise(id, 1); return settingsChanged();
    case "ex-delete": {
      if (!confirm("Delete this exercise?")) return;
      state.exercises = state.exercises.filter((x) => x.id !== id);
      editingId = null;
      return settingsChanged();
    }
    case "ex-add": {
      const ex = { id: "ex-" + Date.now().toString(36), name: "New exercise", category: "other", detail: "", cue: "", enabled: true };
      state.exercises.push(ex);
      editingId = addingId = ex.id;
      save();
      return render();
    }
    case "export": {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `quarter-past-${dayKey(Date.now())}.json` });
      a.click();
      return URL.revokeObjectURL(a.href);
    }
    case "reset": {
      if (!confirm("Reset all exercises and history?")) return;
      stopTimer();
      state = defaultState();
      return settingsChanged();
    }
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.pref) {
    state.prefs[t.dataset.pref] = Number(t.value);
    return settingsChanged();
  }
  if (t.dataset.act === "ex-toggle") {
    const ex = state.exercises.find((x) => x.id === t.dataset.id);
    if (ex) ex.enabled = t.checked;
    return settingsChanged();
  }
  if (t.dataset.act === "import" && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!Array.isArray(data.exercises)) throw new Error();
      state = { ...defaultState(), ...data };
      toast("Imported");
      settingsChanged();
    } catch {
      toast("That file doesn't look right");
    }
    t.value = ""; // so picking the same file again still fires "change"
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-edit]");
  if (!form) return;
  e.preventDefault();
  const ex = state.exercises.find((x) => x.id === form.dataset.edit);
  const f = new FormData(form);
  const num = (k) => Math.max(0, parseInt(f.get(k), 10) || 0);
  Object.assign(ex, {
    name: f.get("name").trim() || ex.name,
    detail: f.get("detail").trim(),
    cue: f.get("cue").trim(),
    category: f.get("category"),
    timer: num("work") > 0 ? { work: num("work"), rest: num("rest"), rounds: Math.max(1, num("rounds")) } : undefined,
  });
  if (!ex.timer) delete ex.timer;
  if (ex.id === current()?.id) stopTimer(); // timer settings may have changed
  editingId = addingId = null;
  settingsChanged();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});
setInterval(() => { if (document.visibilityState === "visible" && !timer?.running) render(); }, 60_000);

// ---------- boot ----------

async function boot() {
  if ("serviceWorker" in navigator) {
    try {
      swReg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      subscribed = !!(await getSubscription());
      if (subscribed) syncServer(); // keep timezone and next exercise fresh
    } catch (err) {
      console.warn("service worker failed", err);
    }
  }
  render();
}

render();
boot();
