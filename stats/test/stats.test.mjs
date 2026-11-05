import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, weekStarts, isPromotion, median, buildStats, duration, delta, aiTools, num, compact } from "../mods/stats/stats.js";
import { contrast, readable } from "../mods/stats/colors.js";

const at = (s) => new Date(s).getTime();
const iso = (s) => new Date(s).toISOString();

test("weekStart is local Monday midnight", () => {
  const d = new Date(weekStart(at("2026-11-01T15:00:00")));
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 26);
  assert.equal(d.getHours(), 0);
  assert.equal(new Date(weekStart(at("2026-10-26T00:00:00"))).getDate(), 26);
});

test("weekStarts ends with this week, oldest first", () => {
  const starts = weekStarts(at("2026-11-01T12:00:00"), 3);
  assert.deepEqual(starts.map((t) => new Date(t).getDate()), [12, 19, 26]);
});

test("a develop -> main release is a promotion; a hotfix to main is not", () => {
  assert.equal(isPromotion({ headRefName: "develop", baseRefName: "main" }), true);
  assert.equal(isPromotion({ headRefName: "fix/x", baseRefName: "main" }), false);
});

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), null);
});

test("buildStats counts merges by week and day, skips releases and duplicates", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (number, created, merged, extra = {}) => ({ repo: "o/a", number, createdAt: iso(created), mergedAt: merged && iso(merged), closedAt: merged && iso(merged), headRefName: "feat", baseRefName: "develop", ...extra });
  const prs = [
    pr(1, "2026-10-27T09:00:00", "2026-10-27T10:00:00"),
    pr(1, "2026-10-27T09:00:00", "2026-10-27T10:00:00"), // same PR from a second search window
    pr(2, "2026-11-01T08:00:00", "2026-11-01T11:00:00"),
    pr(3, "2026-10-20T08:00:00", "2026-10-21T08:00:00"),
    pr(4, "2026-10-31T08:00:00", "2026-10-31T09:00:00", { headRefName: "develop", baseRefName: "main" }),
    { ...pr(5, "2026-10-29T08:00:00", null), closedAt: iso("2026-10-29T09:00:00") },
  ];
  const s = buildStats({ prs, commits: {}, reviews: { last30: 4, prev30: 2 }, open: [{ createdAt: iso("2026-10-29T12:00:00"), headRefName: "x", baseRefName: "develop" }], now, weeks: 2 });
  assert.equal(s.mergedThisWeek, 2);
  assert.equal(s.mergedLastWeek, 1);
  assert.equal(s.merged30, 3);
  assert.deepEqual(s.days.map((d) => d.merged), [0, 1, 0, 0, 0, 0, 1]);
  assert.equal(s.medianHours, 3);
  assert.equal(s.mergeRate, 75);
  assert.equal(s.open, 1);
  assert.equal(s.oldestOpenDays, 3);
});

test("PRs with the same number in two repos both count; repos rank by merges", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (repo, number) => ({ repo, number, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main" });
  const s = buildStats({ prs: [pr("o/a", 1), pr("o/b", 1), pr("o/b", 2)], commits: { "o/a": 7, "o/b": 3 }, now, weeks: 1 });
  assert.equal(s.merged30, 3);
  assert.deepEqual(s.repos, [{ repo: "o/b", merged: 2, commits: 3 }, { repo: "o/a", merged: 1, commits: 7 }]);
  assert.equal(s.commits30, 10);
});

test("this week's commits add up across repos; unknown stays null", () => {
  const now = at("2026-11-01T12:00:00");
  const s = buildStats({ prs: [], commits: { "o/a": 7, "o/b": 3 }, commitsThisWeek: { "o/a": 2, "o/b": 1 }, now, weeks: 1 });
  assert.equal(s.commitsThisWeek, 3);
  assert.equal(buildStats({ prs: [], commits: {}, now, weeks: 1 }).commitsThisWeek, null);
});

test("aiTools reads trailers, sign-off lines and branch names, not review mentions", () => {
  assert.deepEqual(aiTools({ messages: ["fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"] }), { claude: true, codex: false });
  assert.deepEqual(aiTools({ headRefName: "codex/bugs" }), { claude: false, codex: true });
  assert.deepEqual(aiTools({ messages: ["x\n\nCo-Authored-By: Codex <noreply@openai.com>\nCo-Authored-By: Claude <noreply@anthropic.com>"] }), { claude: true, codex: true });
  assert.deepEqual(aiTools({ body: "🤖 Generated with Codex (spec and review by Claude Code)" }), { claude: false, codex: true });
  assert.deepEqual(aiTools({ body: "Codex review (gpt-6.1-sol, high): no findings" }), { claude: false, codex: false });
});

test("a PR from two search windows keeps the copy with AI marks", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (ai) => ({ repo: "o/a", number: 1, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main", ai });
  const s = buildStats({ prs: [pr({ claude: true, codex: false }), pr(null)], now, weeks: 1 });
  assert.deepEqual(s.ai, { claude: 1, codex: 0, both: 0, none: 0, total: 1 });
});

test("AI share splits merged PRs into Claude, Codex, both and none", () => {
  const now = at("2026-11-01T12:00:00");
  const pr = (number, ai) => ({ repo: "o/a", number, createdAt: iso("2026-10-30T08:00:00"), mergedAt: iso("2026-10-30T09:00:00"), headRefName: "f", baseRefName: "main", ai });
  const s = buildStats({ prs: [pr(1, { claude: true, codex: false }), pr(2, { claude: true, codex: true }), pr(3, { claude: false, codex: false }), pr(4, null)], now, weeks: 1 });
  assert.deepEqual(s.ai, { claude: 1, codex: 0, both: 1, none: 1, total: 3 });
});

test("duration and delta format for tiles", () => {
  assert.equal(duration(0.25), "15m");
  assert.equal(duration(1.16), "1.2h");
  assert.equal(duration(72), "3d");
  assert.equal(duration(null), "—");
  assert.deepEqual(delta(5, 3), { d: 2, text: "+2" });
  assert.deepEqual(delta(3, 5), { d: -2, text: "−2" });
  assert.equal(delta(3, 3).text, "same");
  assert.equal(delta(4430, 1200).text, "+3,230");
  assert.equal(delta(1.4, 1.7, duration).text, "−18m");
  assert.equal(delta(3, null), null);
});

test("num groups thousands by hand; compact shortens chart labels", () => {
  assert.equal(num(4430), "4,430");
  assert.equal(num(1234567), "1,234,567");
  assert.equal(num(999), "999");
  assert.equal(num(-1768), "−1,768");
  assert.equal(num(null), "—");
  assert.equal(compact(261), "261");
  assert.equal(compact(1240), "1.2k");
});

// Merges at noon on the given local dates, all into o/a.
const merges = (dates) => dates.map((d, i) => ({ repo: "o/a", number: i + 1, createdAt: iso(`${d}T09:00:00`), mergedAt: iso(`${d}T12:00:00`), headRefName: "f", baseRefName: "develop" }));
const weekOf = (monday, perDay) => perDay.flatMap((n, day) => {
  const d = new Date(`${monday}T00:00:00`); d.setDate(d.getDate() + day);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return Array(n).fill(s);
});

test("pace compares this week with the same days of the usual week, not with whole weeks", () => {
  // Four full weeks of 10 a day, Monday to Friday (50 a week); this week 10 a day Monday to Thursday.
  const days = [...["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].flatMap((m) => weekOf(m, [10, 10, 10, 10, 10, 0, 0])),
    ...weekOf("2026-11-02", [10, 10, 10, 10, 0, 0, 0])];
  const s = buildStats({ prs: merges(days), now: at("2026-11-05T18:00:00"), weeks: 5 });
  assert.equal(s.mergedThisWeek, 40);
  assert.equal(s.mergedLastWeek, 50);
  assert.deepEqual(s.pace, { usualWeek: 50, usualSoFar: 40, diff: 0, projected: 50 });
});

test("pace says behind when this week is slower than usual by now", () => {
  const days = [...["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].flatMap((m) => weekOf(m, [10, 10, 10, 10, 10, 0, 0])),
    ...weekOf("2026-11-02", [5, 5, 5, 5, 0, 0, 0])];
  const s = buildStats({ prs: merges(days), now: at("2026-11-05T18:00:00"), weeks: 5 });
  assert.equal(s.pace.diff, -50);
  assert.equal(s.pace.projected, 25);
});

test("pace gives no verdict early in the week or without history", () => {
  const days = [...["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].flatMap((m) => weekOf(m, [10, 10, 10, 10, 10, 0, 0]))];
  const early = buildStats({ prs: merges(days), now: at("2026-11-02T08:00:00"), weeks: 5 });
  assert.equal(early.pace.diff, null);
  assert.equal(early.pace.projected, null);
  assert.equal(early.pace.usualWeek, 50);
  assert.equal(buildStats({ prs: [], now: at("2026-11-05T18:00:00"), weeks: 1 }).pace, null);
});

test("time to merge compares with the prior 30 days; the oldest open PR is named", () => {
  const now = at("2026-11-05T12:00:00");
  const pr = (number, created, merged) => ({ repo: "o/a", number, createdAt: iso(created), mergedAt: iso(merged), headRefName: "f", baseRefName: "develop" });
  const s = buildStats({
    prs: [pr(1, "2026-11-01T08:00:00", "2026-11-01T10:00:00"), pr(2, "2026-09-20T08:00:00", "2026-09-20T14:00:00")],
    open: [{ repo: "o/b", number: 7, createdAt: iso("2026-05-08T12:00:00"), headRefName: "x", baseRefName: "develop" },
      { repo: "o/a", number: 9, createdAt: iso("2026-11-01T12:00:00"), headRefName: "y", baseRefName: "develop" }],
    now, weeks: 1,
  });
  assert.equal(s.medianHours, 2);
  assert.equal(s.prevMedianHours, 6);
  assert.deepEqual(s.oldestOpen, { repo: "o/b", number: 7 });
  assert.equal(s.oldestOpenDays, 181);
});

test("readable lifts a theme color only as far as the contrast floor", () => {
  // The dim and muted greys from a live screenshot, on its card color.
  assert.ok(contrast("#686970", "#34363e") < 2.5);
  const hint = readable("#686970", "#34363e", 4.5), label = readable("#95969a", "#34363e", 6);
  assert.ok(contrast(hint, "#34363e") >= 4.5 && contrast(hint, "#34363e") < 4.7);
  assert.ok(contrast(label, "#34363e") >= 6);
  assert.ok(contrast(label, "#34363e") > contrast(hint, "#34363e"), "labels stay brighter than hints");
  assert.equal(readable("#e8e9eb", "#202225", 4.5), "#e8e9eb", "already readable: unchanged");
  assert.ok(contrast(readable("#a0a0a0", "#ffffff", 4.5), "#ffffff") >= 4.5, "light themes darken");
  assert.equal(readable("rgb(1,2,3)", "#000000", 4.5), "rgb(1,2,3)", "unknown formats pass through");
});
