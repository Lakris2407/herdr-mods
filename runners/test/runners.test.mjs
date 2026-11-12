import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// `herdr` exists only inside the app: point it at the in-memory stub.
const stub = new URL("./herdr-stub.mjs", import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === "herdr" ? { url: stub, shortCircuit: true } : next(spec, ctx)) });
const { state } = await import("./herdr-stub.mjs");
const poll = await import("../mods/runners/poll.js");
const model = await import("../mods/runners/model.js");
const lanes = await import("../mods/runners/lanesource.js");

const MIN = 60000, now = Date.UTC(2026, 10, 1, 12);
const CONFIG = "/home/test/.config/herdr-app/runners.json";
const read = async () => {
  state.shared.clear();
  const cx = { spawn: (f) => f(cx), notify() {} };
  await poll.tick(cx);
  for (let i = 0; i < 100 && !poll.snapshot(); i++) await new Promise((r) => setTimeout(r, 5));
  return poll.snapshot();
};

test("without a config the panel asks for one and reads nothing", async () => {
  state.files.clear();
  const calls = [];
  state.exec = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  const s = await read();
  assert.equal(s.error, null);
  assert.equal(s.missing, true);
  assert.deepEqual(calls, []);
});

test("demo mode needs no programs and fills every view", async () => {
  state.files.set(CONFIG, JSON.stringify({ demo: true }));
  state.exec = async () => { throw new Error("demo must not run programs"); };
  const s = await read();
  assert.equal(s.demo, true);
  assert.ok(model.waiting(s).length > 0 && model.running(s).length > 0);
  const p = model.plan(s, Date.now());
  assert.equal(p.unplaced.length, 0);
});

test("GitHub jobs, runner status, lanes and ssh load make one snapshot", async () => {
  state.files.set(CONFIG, JSON.stringify({
    repos: [{ repo: "acme/web", short: "WEB" }],
    machines: [{ name: "Build 1", ssh: "me@build-1", lanes: "b1", runners: ["web-1"] }],
    lanes: { name: "game", short: "GAME", command: ["status-cmd"], cwd: "/repo" },
  }));
  const t = new Date(Date.now() - 3 * MIN).toISOString();
  state.exec = async (cmd, args) => {
    if (cmd === "gh" && args[1].endsWith("actions/runs?per_page=30")) return { code: 0, stdout: JSON.stringify({ id: 7, workflow: "CI", title: "x", status: "in_progress", branch: "main", updated: t }) + "\n", stderr: "" };
    if (cmd === "gh" && args[1].includes("/runs/7/jobs")) return { code: 0, stdout: [
      { id: 1, name: "e2e", status: "in_progress", labels: ["self-hosted"], runner: "web-1", created: t, started: t },
      { id: 2, name: "lint", status: "queued", labels: ["ubuntu-latest"], runner: null, created: t },
      { id: 3, name: "e2e", status: "queued", labels: ["self-hosted"], runner: null, created: t },
    ].map((j) => JSON.stringify(j)).join("\n"), stderr: "" };
    if (cmd === "gh" && args[1].includes("actions/runners")) return { code: 0, stdout: JSON.stringify({ name: "web-1", status: "online", busy: true }), stderr: "" };
    if (cmd === "ssh") return { code: 0, stdout: "{ 6.50 5.00 4.00 }\n8\n", stderr: "" };
    if (cmd === "status-cmd") return { code: 0, stdout: "b1 unity: free\nb1 core: core core args:  branch: main commit: abc worktree: w 30s logs: /tmp/l1\nWaiting callers:\n  waiting: unity build args:  branch: feat commit: def worktree: w2 10s logs: /tmp/l2\n", stderr: "" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  const s = await read();
  assert.equal(s.error, null);
  const m = s.machines[0];
  assert.deepEqual([m.load, m.cores], [6.5, 8]);
  assert.deepEqual(m.runners.map((r) => [r.label, r.status, Boolean(r.job)]),
    [["unity lane", "online", false], ["core lane", "online", true], ["web-1", "online", true]]);
  // ubuntu-latest is not watched; the self-hosted queued job and the lanes caller are.
  assert.deepEqual(model.waiting(s).map((j) => j.short).sort(), ["GAME", "WEB"]);
  assert.equal(model.running(s).length, 2);
  // Each GitHub job knows its run, so Finished can put a run's jobs in one row.
  assert.ok(s.jobs.filter((j) => j.short === "WEB").every((j) => j.run === 7));
});

test("lanes status and history parse into jobs", () => {
  const cfg = { name: "game", short: "GAME", hosts: { "build-1.local": "b1" } };
  const st = lanes.parseStatus(cfg, "b1 unity: unreachable\nb1 warm: idle 3 min\nlocal core: busy (no details)\nJoined callers:\n  joined: core core args:  branch: m commit: a worktree: w 5s logs: /tmp/j\n", now);
  assert.deepEqual(st.lanes, { "b1 unity": { state: "unreachable", job: null }, "local core": { state: "busy", job: null } });
  assert.equal(st.warm.b1, "idle 3 min");
  assert.equal(st.jobs[0].status, "joined");
  const sec = now / 1000;
  const h = lanes.parseHistory(cfg, [
    JSON.stringify({ token: "t1", job: "tests", lane: "unity", host: "build-1.local", outcome: "pass", times: { request: sec - 600, lock: sec - 500, end: sec - 400 } }),
    "not json",
    JSON.stringify({ token: "t2", job: "core", lane: "core", host: null, outcome: "skipped", times: { request: sec, lock: null, end: sec } }),
  ].join("\n"), now);
  assert.equal(h.length, 1);
  assert.equal(h[0].runner, "b1 unity");
  assert.equal(h[0].completed - h[0].started, 100000);
});

test("the plan puts waiting jobs on the slot of their pool that frees first", () => {
  const J = (o) => ({ repo: "o/g", short: "G", workflow: "tests", name: "", labels: ["g-ci"], branch: "b", ...o });
  const s = {
    typical: { "o/g:tests:": 3 * MIN },
    machines: [{ name: "A", runners: [{ name: "a", status: "online", job: 1 }, { name: "x", status: "offline", job: null }] },
               { name: "B", runners: [{ name: "b", status: "online", job: null }] }],
    jobs: [J({ id: 1, status: "in_progress", runner: "a", started: now - 2 * MIN, created: now - 3 * MIN }),
           J({ id: 2, status: "completed", conclusion: "success", runner: "b", started: now - 20 * MIN, completed: now - 17 * MIN }),
           J({ id: 3, status: "queued", created: now - 4 * MIN }), J({ id: 4, status: "queued", created: now - 2 * MIN }),
           J({ id: 5, status: "queued", labels: ["other"], created: now - MIN })],
  };
  const p = model.plan(s, now);
  assert.deepEqual(p.placed.map((x) => [x.job.id, x.slot, (x.start - now) / MIN]), [[3, "b", 0], [4, "a", 1]]);
  assert.deepEqual(p.unplaced.map((j) => j.id), [5]);
});

test("a failed read keeps the time of the last good data", async () => {
  state.files.set(CONFIG, JSON.stringify({ demo: true }));
  state.exec = async () => { throw new Error("demo must not run programs"); };
  const good = await read();
  // The next read finds the config broken; the views must not call the old jobs fresh.
  state.files.set(CONFIG, "{ not json");
  poll.refresh();
  await new Promise((r) => setTimeout(r, 2));
  const cx = { spawn: (f) => f(cx), notify() {} };
  await poll.tick(cx);
  for (let i = 0; i < 100 && !poll.snapshot().errorAt; i++) await new Promise((r) => setTimeout(r, 5));
  const s = poll.snapshot();
  assert.equal(s.at, good.at);
  assert.ok(s.errorAt >= good.at);
  assert.match(s.error, /not valid JSON/);
  assert.equal(s.jobs.length, good.jobs.length);
});

test("readable text on a theme fill with alpha reaches the floor", async () => {
  const { readable, flatten, contrast } = await import("../mods/runners/colors.js");
  // A dark theme's border is often white at low alpha; read it as white and the text gets darker, not lighter.
  const fill = flatten("#ffffff18", "#282a36");
  assert.equal(fill, "#3c3e49");
  assert.ok(contrast(readable("#9fa0a5", fill, 4.5), fill) >= 4.5);
  assert.equal(flatten("#282a36", "#000000"), "#282a36");
});

test("the keyboard cursor follows its item, and takes the next one when it leaves", async () => {
  const { step, current } = await import("../mods/runners/keys.js");
  assert.deepEqual(step(["a", "b", "c"], null, 0, 1), { cur: "a", last: 0 });
  assert.deepEqual(step(["a", "b", "c"], "c", 2, 1), { cur: "a", last: 0 });
  assert.deepEqual(step(["a", "b", "c"], "a", 0, -1), { cur: "c", last: 2 });
  // "b" finished and left: the cursor takes what now sits in its place.
  assert.equal(current(["a", "c"], "b", 1), "c");
  assert.equal(current(["a"], "b", 1), "a");
  assert.equal(current([], "b", 1), null);
  assert.deepEqual(step([], "a", 0, 1), { cur: null, last: 0 });
});

test("Escape leaves the panel toward the terminals", async () => {
  const { leaveSide } = await import("../mods/runners/keys.js");
  const panel = { id: "runners", content: { mod: "runners" } }, chip = { content: { mod: "runners", props: { view: "chip" } } };
  const terms = { content: { tab: 0 } };
  assert.equal(leaveSide({ type: "row", children: [terms, { type: "column", children: [panel] }] }, "runners"), "left");
  assert.equal(leaveSide({ type: "row", children: [{ type: "column", children: [chip, panel] }, terms] }, "runners"), "right");
  assert.equal(leaveSide({ type: "column", children: [chip] }, "runners"), "left");
});

test("data with no new read for 3 minutes is stale, even when no read failed", () => {
  assert.deepEqual(model.freshness({ at: now - 2 * MIN }, now), { text: "updated 2m ago", stale: false });
  assert.equal(model.freshness({ at: now - 4 * MIN }, now).stale, true);
  assert.equal(model.freshness({ at: now - MIN, errorAt: now }, now).stale, true);
  assert.equal(model.freshness(null, now).stale, false);
});

test("the banner names offline slots first, then machines ssh can't read", () => {
  const s = { machines: [
    { name: "A", loadError: "timed out", runners: [{ name: "a1", status: "online" }] },
    { name: "B", loadError: null, runners: [{ name: "b1", status: "offline" }, { name: "b2", status: "unknown" }] },
  ] };
  assert.deepEqual(model.problems(s), { off: 1, list: ["b1 offline", "A: ssh failed"] });
  assert.deepEqual(model.problems({ machines: [{ name: "C", runners: [{ name: "c", status: "online" }] }] }), { off: 0, list: [] });
});

test("finished jobs of one run with one outcome share a row; lanes jobs stay single", () => {
  const J = (id, run, conclusion = "success") => ({ id, run, repo: "o/w", conclusion });
  const rows = model.byRun([J(1, 9), J(2, 9), J(3, 9, "cancelled"), J(4, undefined), J(5, 9), J(6, 8)]);
  assert.deepEqual(rows.map((r) => r.jobs.map((j) => j.id)), [[1, 2, 5], [3], [4], [6]]);
  assert.deepEqual(rows.map((r) => r.key), ["o/w#9:success", "o/w#9:cancelled", "job-4", "o/w#8:success"]);
});

test("the chip's counts carry their nouns", () => {
  assert.deepEqual(model.chipWords({ waiting: 4, busy: 7, total: 12 }, 1), { state: "4 jobs waiting", offline: "1 runner offline" });
  assert.deepEqual(model.chipWords({ waiting: 1, busy: 2, total: 12 }, 2), { state: "1 job waiting", offline: "2 runners offline" });
  assert.deepEqual(model.chipWords({ waiting: 0, busy: 3, total: 12 }), { state: "3 jobs running", offline: "" });
  assert.deepEqual(model.chipWords({ waiting: 0, busy: 0, total: 12 }), { state: "runners idle", offline: "" });
  assert.deepEqual(model.chipWords({ waiting: 0, busy: 0, total: 12 }, 2), { state: "", offline: "2 runners offline" });
});

test("an offline slot speaks after a minute, once per machine, and again when all are back", () => {
  const m = (a, b) => [{ name: "Claws mini", runners: [{ name: "core", status: a }, { name: "unity", status: b }] }];
  let r = model.offlineNews(undefined, m("offline", "offline"), 0);
  assert.deepEqual(r.posts, []);
  // A flap: back before the minute, nothing said.
  r = model.offlineNews(r.state, m("online", "offline"), 30000);
  assert.deepEqual(r.posts, []);
  r = model.offlineNews(r.state, m("offline", "offline"), 40000);
  r = model.offlineNews(r.state, m("offline", "offline"), 61000);
  assert.deepEqual(r.posts, [{ kind: "off", machine: "Claws mini", names: ["unity"] }]);
  r = model.offlineNews(r.state, m("offline", "offline"), 101000);
  assert.deepEqual(r.posts, [{ kind: "off", machine: "Claws mini", names: ["core"] }]);
  r = model.offlineNews(r.state, m("offline", "offline"), 200000);
  assert.deepEqual(r.posts, []);
  r = model.offlineNews(r.state, m("online", "offline"), 210000);
  assert.deepEqual(r.posts, []);
  r = model.offlineNews(r.state, m("online", "online"), 220000);
  // The toast names every slot that came back, not only the last one.
  assert.deepEqual(r.posts, [{ kind: "back", machine: "Claws mini", names: ["core", "unity"] }]);
  assert.equal(model.offlineToast(r.posts[0]).body, "2 runners take jobs again");
  assert.deepEqual(r.state.returned, {});
});

test("a slot back early that drops again is not named back", () => {
  const m = (a, b) => [{ name: "Claws mini", runners: [{ name: "core", status: a }, { name: "unity", status: b }] }];
  let r = model.offlineNews(undefined, m("offline", "offline"), 0);
  r = model.offlineNews(r.state, m("offline", "offline"), 60000);
  r = model.offlineNews(r.state, m("online", "offline"), 70000);
  assert.deepEqual(r.state.returned, { "Claws mini": ["core"] });
  r = model.offlineNews(r.state, m("offline", "offline"), 80000);
  r = model.offlineNews(r.state, m("offline", "offline"), 140000);
  assert.deepEqual(r.posts, [{ kind: "off", machine: "Claws mini", names: ["core"] }]);
  assert.deepEqual(r.state.returned, {});
  r = model.offlineNews(r.state, m("offline", "online"), 150000);
  assert.deepEqual(r.posts, []);
  // A machine that leaves the config takes its pending slots with it.
  assert.deepEqual(model.offlineNews(r.state, [], 160000).state, { since: {}, told: {}, returned: {} });
});

test("the first copy to claim a command acts, the others skip it", () => {
  state.shared.clear();
  assert.equal(poll.claim("runners.show", 2000, 1000), true);
  assert.equal(poll.claim("runners.show", 2000, 1500), false);
  assert.equal(poll.claim("runners.show", 2000, 3001), true);
});

test("two slots of one machine share one toast", () => {
  const m = [{ name: "Claws mini", runners: [{ name: "core", status: "offline" }, { name: "unity", status: "offline" }] }];
  const r = model.offlineNews(model.offlineNews(undefined, m, 0).state, m, 60000);
  assert.deepEqual(r.posts, [{ kind: "off", machine: "Claws mini", names: ["core", "unity"] }]);
  assert.equal(model.offlineToast(r.posts[0]).title, "2 runners on Claws mini are offline");
  assert.equal(model.offlineToast({ kind: "off", machine: "Claws mini", names: ["core"] }).body, "Claws mini · jobs wait for another slot · open Runners");
});

test("a finished run counts for two hours, also after the newest runs push it off the list", async () => {
  state.shared.clear();
  state.files.set(CONFIG, JSON.stringify({ repos: [{ repo: "acme/web", short: "WEB" }], machines: [{ name: "Build 1", runners: ["web-1"] }] }));
  const iso = (ms) => new Date(Date.now() - ms).toISOString();
  let listed = [7];
  state.exec = async (cmd, args) => {
    if (args[1].endsWith("actions/runs?per_page=30")) return { code: 0, stdout: listed.map((id) => JSON.stringify({ id, workflow: "CI", title: "x", status: "completed", branch: "main", updated: iso(10 * MIN) })).join("\n"), stderr: "" };
    if (args[1].includes("/jobs")) return { code: 0, stdout: JSON.stringify({ id: Number(/runs\/(\d+)/.exec(args[1])[1]) * 10, name: "e2e", status: "completed", conclusion: "success", labels: ["self-hosted"], runner: "web-1", created: iso(15 * MIN), started: iso(14 * MIN), completed: iso(10 * MIN) }), stderr: "" };
    if (args[1].includes("actions/runners")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  const first = await read();
  listed = [8];
  // A second read on the same state (read() starts clean): ask for a refresh, then wait for the new snapshot.
  state.shared.set("runners.refresh", Date.now() + 1000);
  const cx = { spawn: (f) => f(cx), notify() {} };
  await poll.tick(cx);
  for (let i = 0; i < 100 && poll.snapshot() === first; i++) await new Promise((r) => setTimeout(r, 5));
  const s = poll.snapshot();
  assert.deepEqual(s.jobs.map((j) => j.run).sort(), [7, 8]);
  assert.equal(s.samples["acme/web:CI:e2e"], 2);
});

test("a job is slow only against a usual length that three finished runs stand on", () => {
  const now = 100 * MIN, j = { repo: "o/r", workflow: "CI", name: "test", started: now - 3 * MIN };
  const s = { typical: { "o/r:CI:test": MIN }, samples: { "o/r:CI:test": 2 } };
  assert.equal(model.isSlow(j, s, now), false);
  s.samples["o/r:CI:test"] = 3;
  assert.equal(model.isSlow(j, s, now), true);
  assert.equal(model.isSlow({ ...j, started: now - MIN }, s, now), false);
});
