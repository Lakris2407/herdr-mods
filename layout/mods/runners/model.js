// What the views show, from a snapshot: pure functions, no herdr calls.

const MIN = 60000, GUESS = 5 * MIN;
// Past this with no new read (the app slept, or no view polled), the data is old even though no read failed.
const STALE = 3 * MIN;

export const jobKey = (j) => j.key ?? `${j.repo}:${j.workflow}:${j.name}`;

export function median(list) {
  const s = [...list].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// "CI PR #921 · e2e": the workflow, then the job when it says more than the workflow does.
export function label(j) {
  const job = j.name && !j.workflow.toLowerCase().includes(j.name.toLowerCase()) ? ` · ${j.name}` : "";
  return `${j.workflow}${job}`;
}

export const waiting = (s) => s.jobs.filter((j) => j.status === "queued").sort((a, b) => a.created - b.created);
export const running = (s) => s.jobs.filter((j) => j.status === "in_progress").sort((a, b) => a.started - b.started);
export const finished = (s, now, ms = 3600000) =>
  s.jobs.filter((j) => j.status === "completed" && j.completed && now - j.completed < ms && j.conclusion !== "skipped")
    .sort((a, b) => b.completed - a.completed);

export const slots = (s) => s.machines.flatMap((m) => m.runners.map((r) => ({ ...r, machine: m.name })));

// Which slots could take a job: the ones whose machine lists them and whose job pool label matches,
// judged by the runners that took jobs with the same labels before.
export function poolOf(s, j) {
  const want = j.labels.join(",");
  const seen = new Set(s.jobs.filter((x) => x.runner && x.labels.join(",") === want).map((x) => x.runner));
  return slots(s).filter((r) => seen.has(r.name));
}

export function duration(ms) {
  if (ms == null || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  // "7m 53s", not "7:53", which reads as a time of day; the same units as the quota's "2h 5m".
  if (min < 60) return sec % 60 && min < 10 ? `${min}m ${sec % 60}s` : `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function ago(at, now) {
  const sec = Math.round((now - at) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

// How old the data is. A failed read keeps the time of the last good data, so the header never says "just now" over old jobs.
export function freshness(s, now) {
  if (!s) return { text: "Loading…", stale: false };
  if (s.errorAt) return { text: s.at ? `data from ${ago(s.at, now)} · last read failed` : "could not read the runners", stale: true };
  return { text: `updated ${ago(s.at, now)}`, stale: s.at != null && now - s.at > STALE };
}

// What needs a look on the machines, for the panel's banner: slots offline, then machines ssh can't read.
export function problems(s) {
  const off = s.machines.flatMap((m) => m.runners.filter((r) => r.status === "offline").map((r) => `${r.name} offline`));
  const ssh = s.machines.filter((m) => m.loadError).map((m) => `${m.name}: ssh failed`);
  return { off: off.length, list: [...off, ...ssh] };
}

// Finished jobs of one GitHub run with one outcome make one row; lanes jobs have no run and stay single.
// The list comes newest first, so a row's first job is its latest.
export function byRun(list) {
  const rows = [], at = new Map();
  for (const j of list) {
    const k = j.run != null ? `${j.repo}#${j.run}:${j.conclusion}` : null;
    if (k && at.has(k)) { at.get(k).jobs.push(j); continue; }
    const row = { key: k ?? `job-${j.id}`, jobs: [j] };
    rows.push(row);
    if (k) at.set(k, row);
  }
  return rows;
}

// Load per core, 0..1+: a machine at 8 on 8 cores is full.
export const pressure = (m) => (m.load == null || !m.cores ? null : m.load / m.cores);

// Offline toasts. A slot that drops for a moment and comes back says nothing: it must stay offline
// OFF_MS first. Then one toast per machine, not per slot, and one more when they are all back, naming
// every slot that was told offline (`returned` keeps the ones back early until the last one is).
// `was`: { since: {slot: ms}, told: {slot: machine}, returned: {machine: [slot]} } from the last
// snapshot. Returns the next state and what to post: [{ kind: "off" | "back", machine, names }].
export const OFF_MS = 60000;
export function offlineNews(was, machines, now) {
  const since = {}, told = { ...(was?.told ?? {}) }, returned = { ...(was?.returned ?? {}) }, posts = [];
  for (const m of machines) {
    const off = m.runners.filter((r) => r.status === "offline");
    for (const r of off) since[r.name] = was?.since?.[r.name] ?? now;
    const fresh = off.filter((r) => now - since[r.name] >= OFF_MS && !told[r.name]).map((r) => r.name);
    if (fresh.length) { posts.push({ kind: "off", machine: m.name, names: fresh }); for (const n of fresh) told[n] = m.name; }
    const back = m.runners.filter((r) => told[r.name] && r.status === "online").map((r) => r.name);
    for (const n of back) delete told[n];
    // A slot told offline again is no longer back.
    const all = [...(returned[m.name] ?? []).filter((n) => !told[n]), ...back];
    delete returned[m.name];
    if (!all.length) continue;
    if (Object.values(told).includes(m.name)) returned[m.name] = all;
    else posts.push({ kind: "back", machine: m.name, names: all });
  }
  // A slot or machine no one lists any more is forgotten.
  const listed = new Set(machines.flatMap((m) => m.runners.map((r) => r.name)));
  for (const n of Object.keys(told)) if (!listed.has(n)) delete told[n];
  const shown = new Set(machines.map((m) => m.name));
  for (const [machine, names] of Object.entries(returned)) {
    const kept = names.filter((n) => listed.has(n));
    if (shown.has(machine) && kept.length) returned[machine] = kept; else delete returned[machine];
  }
  return { state: { since, told, returned }, posts };
}

// The words of one offline toast.
export function offlineToast(p) {
  const one = p.names.length === 1;
  if (p.kind === "back") return { title: `${p.machine} is back online`, body: one ? `${p.names[0]} takes jobs again` : `${p.names.length} runners take jobs again` };
  return { title: one ? `${p.names[0]} is offline` : `${p.names.length} runners on ${p.machine} are offline`,
    body: `${one ? p.machine + " · jobs" : "Their jobs"} wait for another slot · open Runners` };
}

// The chip's words. Each count carries its noun, so "4 waiting" beside "7 agents" never reads as
// agents waiting on you: "4 jobs waiting", "1 runner offline".
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
export function chipWords(sum, offline = 0) {
  // "runners idle" beside "2 runners offline" says nothing more: offline alone.
  const state = sum.waiting ? `${plural(sum.waiting, "job")} waiting` : sum.busy ? `${plural(sum.busy, "job")} running` : offline ? "" : "runners idle";
  return { state, offline: offline ? `${plural(offline, "runner")} offline` : "" };
}

export function summary(s, now = Date.now()) {
  const all = slots(s), w = waiting(s);
  return {
    waiting: w.length,
    longest: w.length ? now - w[0].created : 0,
    busy: all.filter((r) => r.job).length,
    total: all.length,
  };
}

// Today's median wait from queue to start, for the panel's tile.
export function medianWait(s, now) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const waits = s.jobs.filter((j) => j.started && j.created && j.started >= start.getTime()).map((j) => j.started - j.created);
  return waits.length ? median(waits) : null;
}

// Waiting jobs, oldest first, each on the slot of its pool that frees up first.
export function plan(s, now) {
  const free = new Map(slots(s).map((r) => {
    if (r.status === "offline") return [r.name, Infinity];
    const j = r.job && s.jobs.find((x) => x.id === r.job);
    const usual = j && s.typical[jobKey(j)];
    return [r.name, j ? Math.max(now + MIN, j.started + (usual ?? GUESS)) : now];
  }));
  const placed = [], unplaced = [];
  for (const j of waiting(s)) {
    const pool = poolOf(s, j).filter((r) => free.get(r.name) < Infinity);
    if (!pool.length) { unplaced.push(j); continue; }
    const r = pool.reduce((a, b) => (free.get(b.name) < free.get(a.name) ? b : a));
    const start = Math.max(now, free.get(r.name)), len = s.typical[jobKey(j)] ?? GUESS;
    free.set(r.name, start + len);
    placed.push({ job: j, slot: r.name, start, end: start + len });
  }
  return { placed, unplaced };
}

