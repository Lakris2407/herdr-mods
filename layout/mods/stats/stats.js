// Your own delivery numbers from raw GitHub rows. Pure: no herdr imports, so `node --test` can load it.

const DAY = 86400000, WEEK = 7 * DAY;

// Monday 00:00 in local time, so "this week" matches your own calendar.
export function weekStart(at) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// The start of each of the last `count` weeks, oldest first, ending with this week.
export function weekStarts(now, count) {
  const current = weekStart(now);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(current);
    d.setDate(d.getDate() - 7 * (count - 1 - i));
    return d.getTime();
  });
}

// A release (develop -> main) repeats work already counted when it merged into develop.
export const isPromotion = (pr) => pr.headRefName === "develop" && pr.baseRefName === "main";

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const between = (iso, from, to) => { const t = Date.parse(iso); return t >= from && t < to; };

// Which AI tools made a PR. "Codex" in a PR text usually means a Codex review, so only its
// own sign-off line counts there; branch names and commit trailers are the stronger marks.
export function aiTools({ body = "", headRefName = "", messages = [] }) {
  const trailers = messages.join("\n");
  return {
    claude: /^co-authored-by:\s*claude/im.test(trailers) || /generated with \[?claude code/i.test(body) || /^claude\//.test(headRefName),
    codex: /^co-authored-by:\s*codex/im.test(trailers) || /generated with \[?codex/i.test(body) || /^codex\//.test(headRefName),
  };
}

// An open PR older than this many days is stale: worth closing or finishing.
export const STALE_PR_DAYS = 30;

// prs: [{ repo, number, state, createdAt, mergedAt, closedAt, headRefName, baseRefName, ai: {claude, codex} | null }]
// commits / commitsThisWeek: { "owner/repo": count } for the last 30 days / this week; reviews: { last30, prev30 };
// open: [{ repo, number, createdAt, isDraft, reviewDecision, checks }] (your open PRs);
// reviewRequests: [{ repo, number, createdAt }] (other people's open PRs that ask for your review).
export function buildStats({ prs, commits, commitsThisWeek, reviews, open, reviewRequests, now, weeks = 12 }) {
  const work = dedupe(prs).filter((pr) => !isPromotion(pr));
  const merged = work.filter((pr) => pr.mergedAt);
  const starts = weekStarts(now, weeks);
  const thisWeek = starts[starts.length - 1];

  const perWeek = starts.map((start, i) => ({
    start,
    merged: merged.filter((pr) => between(pr.mergedAt, start, starts[i + 1] ?? start + WEEK)).length,
  }));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() + i);
    const start = d.getTime(), end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return { start, merged: merged.filter((pr) => between(pr.mergedAt, start, end)).length, future: start > now };
  });

  const last30 = merged.filter((pr) => between(pr.mergedAt, now - 30 * DAY, now + 1));
  const prev30 = merged.filter((pr) => between(pr.mergedAt, now - 60 * DAY, now - 30 * DAY));
  const hoursOf = (list) => list.map((pr) => (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3600000);

  // Decided in the last 30 days, the window of every other number in its card: merged, or closed without a merge.
  const decided = work.filter((pr) => between(pr.mergedAt ?? pr.closedAt ?? "", now - 30 * DAY, now + 1));
  const rate = decided.length ? Math.round(100 * decided.filter((pr) => pr.mergedAt).length / decided.length) : null;

  const byRepo = {};
  for (const pr of last30) byRepo[pr.repo] = (byRepo[pr.repo] ?? 0) + 1;
  const repos = Object.entries(byRepo).map(([repo, n]) => ({ repo, merged: n, commits: commits?.[repo] ?? 0 }))
    .sort((a, b) => b.merged - a.merged || a.repo.localeCompare(b.repo));

  // AI share over the last 30 days' merged PRs that still had their texts loaded.
  const rated = last30.filter((pr) => pr.ai);
  const ai = { claude: 0, codex: 0, both: 0, none: 0, total: rated.length };
  const toolOf = (a) => (a.claude && a.codex ? "both" : a.claude ? "claude" : a.codex ? "codex" : "none");
  for (const { ai: a } of rated) ai[toolOf(a)]++;
  // Median time to merge for each tool, so Claude and Codex compare on more than volume.
  const aiHours = Object.fromEntries(["claude", "codex", "both", "none"].map((k) =>
    [k, median(hoursOf(rated.filter((pr) => toolOf(pr.ai) === k)))]));

  const openPrs = (open ?? []).filter((pr) => !isPromotion(pr));
  const oldestPr = oldest(openPrs);
  const waiting = waitingOn(openPrs, reviewRequests ?? []);
  const stale = openPrs.filter((pr) => now - Date.parse(pr.createdAt) > STALE_PR_DAYS * DAY);

  return {
    weeks: perWeek,
    days,
    mergedThisWeek: perWeek[perWeek.length - 1].merged,
    mergedLastWeek: perWeek[perWeek.length - 2]?.merged ?? 0,
    pace: weekPace(merged, starts, perWeek, now),
    merged30: last30.length,
    mergedPrev30: prev30.length,
    medianHours: median(hoursOf(last30)),
    prevMedianHours: median(hoursOf(prev30)),
    open: openPrs.length,
    oldestOpenDays: oldestPr ? Math.floor((now - Date.parse(oldestPr.createdAt)) / DAY) : null,
    oldestOpen: ref(oldestPr),
    stale: stale.length,
    waiting,
    repos,
    commits30: Object.values(commits ?? {}).reduce((s, n) => s + n, 0),
    // Null when the source gave no weekly count (older cache, demo), so the line stays hidden instead of showing 0.
    commitsThisWeek: commitsThisWeek == null ? null : Object.values(commitsThisWeek).reduce((s, n) => s + n, 0),
    ai,
    aiHours,
    reviews: reviews ?? { last30: 0, prev30: 0 },
    mergeRate: rate,
    decided: decided.length,
  };
}

const ref = (pr) => (pr?.repo ? { repo: pr.repo, number: pr.number } : null);
const oldest = (list) => list.reduce((o, pr) => (!o || Date.parse(pr.createdAt) < Date.parse(o.createdAt) ? pr : o), null);

// What waits on you, most urgent first: reviews you were asked for, then your own PRs whose checks
// fail, that a reviewer sent back, or that are ready to merge (checks pass, not a draft, no review
// blocking). Each bucket keeps its count and its oldest PR, so a bucket of one opens that PR.
export function waitingOn(openPrs, reviewRequests) {
  const fails = (pr) => pr.checks === "FAILURE" || pr.checks === "ERROR";
  const ready = (pr) => !pr.isDraft && pr.checks === "SUCCESS"
    && pr.reviewDecision !== "CHANGES_REQUESTED" && pr.reviewDecision !== "REVIEW_REQUIRED";
  const bucket = (key, list) => ({ key, count: list.length, first: ref(oldest(list)) });
  return [
    bucket("review", reviewRequests),
    bucket("failing", openPrs.filter(fails)),
    bucket("changes", openPrs.filter((pr) => pr.reviewDecision === "CHANGES_REQUESTED")),
    bucket("ready", openPrs.filter(ready)),
  ];
}

// This week against your usual week at the same point: a Thursday is compared with the Monday to
// Thursday of earlier weeks, not with whole weeks. Usual = the median of the last four full weeks.
// `diff` (percent ahead or behind) and `projected` (where the week ends at your usual shape) stay
// null until a usual week has at least 3 merges by this point, so a Monday morning shows no verdict.
const PACE_WEEKS = 4, PACE_FLOOR = 3;
export function weekPace(merged, starts, perWeek, now) {
  const full = starts.slice(0, -1).slice(-PACE_WEEKS);
  if (!full.length) return null;
  const elapsed = now - starts[starts.length - 1];
  const usualSoFar = median(full.map((ws) => merged.filter((pr) => between(pr.mergedAt, ws, ws + elapsed)).length));
  const usualWeek = median(perWeek.slice(0, -1).slice(-PACE_WEEKS).map((w) => w.merged));
  const thisWeek = perWeek[perWeek.length - 1].merged;
  const known = usualSoFar >= PACE_FLOOR;
  return {
    usualWeek, usualSoFar,
    diff: known ? Math.round(100 * (thisWeek - usualSoFar) / usualSoFar) : null,
    projected: known ? Math.max(thisWeek, Math.round(thisWeek * usualWeek / usualSoFar)) : null,
  };
}

// 4,430: grouped by hand, because the Herdr runtime's toLocaleString leaves digits ungrouped.
export function num(n) {
  if (n == null) return "—";
  const [whole, frac] = String(Math.abs(n)).split(".");
  return `${n < 0 ? "−" : ""}${whole.replace(/\B(?=(\d{3})+$)/g, ",")}${frac ? `.${frac}` : ""}`;
}

// 1.2k for chart labels, where a bar is about 20px wide.
export const compact = (n) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString()}k` : String(n));

// The same PR can come back from two search windows; numbers repeat across repos. At the AI cutoff
// one copy has its AI marks and the other not: keep the one with marks.
function dedupe(prs) {
  const byKey = new Map();
  for (const pr of prs) {
    const key = `${pr.repo}#${pr.number}`, seen = byKey.get(key);
    if (!seen?.ai || pr.ai) byKey.set(key, pr);
  }
  return [...byKey.values()];
}

// 1.4h, 35m, 2.1d: short enough for a tile.
export function duration(hours) {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${(Math.round(hours * 10) / 10).toString()}h`;
  return `${(Math.round(hours / 2.4) / 10).toString()}d`;
}

// The change against a baseline, in words, so the verdict never rests on color: "274 more", "9 fewer",
// "17m slower", "same". `d` keeps the direction for the caller's tone; `pct` is the change as a
// percentage of the baseline (null when the baseline is 0).
export const COUNT_WORDS = ["more", "fewer"], TIME_WORDS = ["slower", "faster"];
export function change(now, before, { format = num, words = COUNT_WORDS } = {}) {
  if (before == null || now == null) return null;
  const d = now - before;
  return { d, pct: before ? Math.round(100 * d / before) : null, text: d === 0 ? "same" : `${format(Math.abs(d))} ${d > 0 ? words[0] : words[1]}` };
}

// What went wrong, as a sentence that says what to do. `gh` and our own messages pass through; GitHub's
// raw API errors get a plain sentence first.
export function plainError(message) {
  const m = String(message ?? "").trim();
  if (/rate limit/i.test(m)) return "GitHub's API limit is used up for now. Refresh again in a few minutes.";
  if (/could not resolve|connection|timed? ?out|network|EOF|ENOTFOUND|ECONNRESET/i.test(m))
    return "Couldn't reach GitHub. Check the network, then refresh.";
  if (/^gh is not installed|^Run gh auth login|is not valid JSON$/.test(m)) return m;
  return m ? `GitHub returned an error: ${m}` : "Couldn't load your numbers. Refresh to try again.";
}
