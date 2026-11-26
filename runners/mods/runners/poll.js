// The lock outlives a slow read (a lanes status command may ask several machines) but not one a hot reload cut off.
// One snapshot in shared state for every copy (chip, panel, popup, timeline): whichever copy finds it
// due takes a short lock and reads, so the status bar and the panel never ask GitHub twice.
import { shared, setShared, notify } from "herdr";
import { loadConfig } from "./config.js";
import { loadJobs, machineLoad } from "./load.js";
import { loadLanes } from "./lanesource.js";
import { demoSnapshot } from "./demo.js";
import { jobKey, median, label, offlineNews, offlineToast } from "./model.js";

export const KEY = "runners.v1";
const LOCK = "runners.lock", REFRESH = "runners.refresh";
const BUSY_MS = 20000, IDLE_MS = 60000, LOAD_MS = 60000, LOCK_MS = 45000;
// A machine counts as unreachable over ssh only after its reads have failed for this long:
// a Tailscale path can drop for 30-50 s while the machine itself stays up.
export const GRACE_MS = 60000;
const outage = (since, now) => ({ since: since ?? now, over: now - (since ?? now) >= GRACE_MS });

export const snapshot = () => shared(KEY) ?? null;
export const refresh = () => setShared(REFRESH, Date.now());

// Every copy of the mod (chip, panel, popup, timeline) gets a command such as `runners.panel`. The
// first copy to claim it acts, so one toast click opens one popup.
export function claim(key, ms, now = Date.now()) {
  if ((shared(key) ?? 0) > now) return false;
  setShared(key, now + ms);
  return true;
}

// When the snapshot was last read or last tried: a failed read keeps `at`, the time of the data it shows.
const tried = (s) => Math.max(s?.at ?? 0, s?.errorAt ?? 0);

function due(s, now) {
  if (!s) return true;
  if ((shared(REFRESH) ?? 0) > tried(s)) return true;
  const busy = s.jobs.some((j) => j.status !== "completed");
  return now - tried(s) >= (busy ? BUSY_MS : IDLE_MS);
}

export function tick(cx) {
  const now = Date.now(), s = snapshot();
  if (!due(s, now) || (shared(LOCK) ?? 0) > now) return;
  setShared(LOCK, now + LOCK_MS);
  cx.spawn(async (cx) => {
    let next;
    try {
      next = await read(s, now);
    } catch (e) {
      // Keep the last good data and its time, so no view calls it fresh.
      next = { ...(s ?? { at: null, jobs: [], machines: [], done: {}, typical: {}, samples: {} }), errorAt: now, error: String(e.message ?? e) };
    } finally {
      setShared(LOCK, 0);
    }
    announce(s, next, now);
    setShared(KEY, next);
    cx.notify();
  });
}

async function read(prev, now) {
  const config = await loadConfig();
  if (config.demo) return demoSnapshot(now);
  const fresh = (shared(REFRESH) ?? 0) > tried(prev);
  const loadDue = fresh || !prev || now - (prev.loadAt ?? 0) >= LOAD_MS;
  const [gh, ln, loads] = await Promise.all([
    loadJobs(config, prev?.done ?? {}, now),
    // The lanes runner is its own source: when it fails, GitHub's slots still show.
    config.lanes ? loadLanes(config.lanes, now).catch((e) => ({ error: String(e.message ?? e), lanes: {}, warm: {}, jobs: [] })) : null,
    loadDue ? Promise.all(config.machines.map((m) => (m.ssh ? machineLoad(m.ssh) : null))) : null,
  ]);
  const { done, runners } = gh, jobs = [...gh.jobs, ...(ln?.jobs ?? [])];
  const busyOn = new Map(jobs.filter((j) => j.status === "in_progress" && j.runner).map((j) => [j.runner, j.id]));
  // `alive` is whether the machine runs the slot's listener (true or false), or null when nobody looked.
  // A running listener beats GitHub's "offline": GitHub's runner list can call a runner offline while it
  // takes and finishes jobs (seen after a repo moved to another owner). A missing listener is offline.
  const slot = (name, alive = null) => ({
    name, label: name, job: busyOn.get(name) ?? null,
    status: busyOn.has(name) ? "online" : alive === false ? "offline" : alive ? "online" : runners[name]?.status ?? "unknown",
  });
  // A machine's lanes are the ones the status command reports for its name. An ssh call that
  // fails once (a short Tailscale drop) keeps the lane's last status until it has failed for GRACE_MS.
  const laneSlots = (key, old) => Object.entries(ln?.lanes ?? {}).filter(([name]) => name.startsWith(`${key} `)).map(([name, l]) => {
    const was = old?.runners.find((r) => r.name === name);
    const down = l.state === "unreachable" ? outage(was?.downSince, now) : null;
    return {
      name, label: `${name.slice(key.length + 1)} lane`, job: busyOn.get(name) ?? null,
      status: !down ? "online" : down.over ? "offline" : was?.status ?? "unknown", downSince: down?.since ?? null,
    };
  });
  // The same for the load read: within the grace the last numbers stay and no error shows.
  const machineLoadNow = (l, old) => {
    if (!l?.error) return { load: l?.load ?? null, cores: l?.cores ?? null, listeners: l?.listeners ?? null, loadError: null, loadErrorSince: null };
    const down = outage(old?.loadErrorSince, now);
    return down.over ? { load: null, cores: null, listeners: null, loadError: l.error, loadErrorSince: down.since }
      : { load: old?.load ?? null, cores: old?.cores ?? null, listeners: old?.listeners ?? null, loadError: old?.loadError ?? null, loadErrorSince: down.since };
  };
  const machines = config.machines.map((m, i) => {
    const old = prev?.machines?.find((p) => p.name === m.name);
    const l = loads ? machineLoadNow(loads[i], old) : old;
    const lanes = m.lanes ? laneSlots(m.lanes, old) : [];
    // A runner with a folder in "listeners" is alive while a listener command line holds that folder.
    const alive = (name) => (m.listeners?.[name] && l?.listeners ? l.listeners.some((c) => c.includes(m.listeners[name])) : null);
    return { name: m.name, ssh: m.ssh ?? null, load: l?.load ?? null, cores: l?.cores ?? null, listeners: l?.listeners ?? null,
      loadError: l?.loadError ?? null, loadErrorSince: l?.loadErrorSince ?? null, warm: m.lanes ? ln?.warm[m.lanes] ?? null : null,
      runners: [...lanes, ...(m.runners ?? []).map((name) => slot(name, alive(name)))] };
  });
  // A slot no machine lists still shows, so a new runner is never invisible.
  const listed = new Set(machines.flatMap((m) => m.runners.map((r) => r.name)));
  const extra = [...new Set([...Object.keys(runners), ...gh.jobs.map((j) => j.runner).filter(Boolean)])].filter((n) => !listed.has(n) && !n.startsWith("GitHub Actions"));
  if (extra.length) machines.push({ name: config.machines.length ? "Other runners" : "Runners", ssh: null, load: null, cores: null, loadError: null, warm: null, runners: extra.map((name) => slot(name)) });

  // How long each job usually takes, from the last two hours, kept across restarts.
  const typical = { ...(prev?.typical ?? {}) }, groups = {};
  for (const j of jobs) if (j.status === "completed" && j.conclusion === "success" && j.started && j.completed) (groups[jobKey(j)] ??= []).push(j.completed - j.started);
  // `samples` says how many runs a usual length stands on: too few and no view calls a job slow.
  const samples = {};
  for (const [k, list] of Object.entries(groups)) { typical[k] = median(list); samples[k] = list.length; }

  const waiting = new Set(jobs.filter((j) => j.status === "queued").map((j) => j.id));
  const alerted = (prev?.alerted ?? []).filter((id) => waiting.has(id));
  return { at: now, errorAt: null, loadAt: loadDue ? now : prev.loadAt, error: ln?.error ? `Lanes status: ${ln.error}` : null, missing: Boolean(config.missing), jobs, done, machines, typical, samples, alerted,
    alertAfter: config.waitAlertMinutes * 60000 };
}

// Toasts: a job waiting too long (once each), a slot that drops offline.
function announce(prev, next, now) {
  if (!prev || next.demo) return;
  for (const j of next.jobs) {
    if (j.status !== "queued" || next.alerted.includes(j.id) || now - j.created < next.alertAfter) continue;
    next.alerted.push(j.id);
    notify({ title: `Waiting ${Math.round((now - j.created) / 60000)}m for a runner`, body: `${j.short} · ${label(j)} · ${j.branch} · needs ${j.labels.join(", ")}`, level: "warning", timeout: 10000 });
  }
  // A failed read keeps the last machines: it says nothing about who is offline.
  if (next.errorAt && next.at !== now) { next.offline = prev.offline; return; }
  const news = offlineNews(prev.offline, next.machines, now);
  next.offline = news.state;
  for (const p of news.posts) {
    const words = offlineToast(p);
    notify({ ...words, level: p.kind === "off" ? "error" : "success", timeout: p.kind === "off" ? 20000 : 6000,
      action: { name: "runners.panel" } });
  }
}
