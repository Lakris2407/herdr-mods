// Made-up raw rows in the shape loadRaw returns, for screenshots: the panel with `{ "demo": true }`
// in its block's props shows these and runs nothing. Pure and seeded, so every run draws the same panel.
import { weekStarts } from "./stats.js";

const DAY = 86400000, HOUR = 3600000;
const REPOS = ["acme/api", "acme/web", "acme/mobile", "acme/billing", "acme/infra", "acme/docs", "acme/search", "acme/design-system"];
const WEIGHT = [30, 22, 14, 10, 8, 6, 5, 5];

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

export function demoRaw(now = Date.now(), weeks = 12) {
  const r = rng(42), prs = [];
  const pick = () => { let x = r() * 100; for (let i = 0; i < REPOS.length; i++) { x -= WEIGHT[i]; if (x < 0) return REPOS[i]; } return REPOS[0]; };
  const tool = () => { const x = r(); return x < 0.55 ? { claude: true, codex: false } : x < 0.82 ? { claude: false, codex: true } : x < 0.97 ? { claude: true, codex: true } : { claude: false, codex: false }; };
  let number = 1000;
  // About 18 merges a working day, rising over the 13 weeks, fewer on weekends.
  for (let d = 91; d >= 0; d--) {
    const day = now - d * DAY, weekday = (new Date(day).getDay() + 6) % 7;
    const n = Math.round((weekday > 4 ? 3 : 12 + 10 * (1 - d / 91)) * (0.7 + 0.6 * r()));
    for (let i = 0; i < n; i++) {
      const merged = day - r() * 10 * HOUR;
      if (merged > now) continue;
      const created = merged - (0.2 + r() * r() * 30) * HOUR;
      prs.push({ repo: pick(), number: number++, state: "MERGED", createdAt: new Date(created).toISOString(), mergedAt: new Date(merged).toISOString(),
        closedAt: new Date(merged).toISOString(), headRefName: "feat", baseRefName: "develop", ai: d <= 30 ? tool() : null });
    }
    if (r() < 0.4) {
      const closed = day - r() * 8 * HOUR;
      prs.push({ repo: pick(), number: number++, state: "CLOSED", createdAt: new Date(closed - 5 * HOUR).toISOString(), mergedAt: null,
        closedAt: new Date(closed).toISOString(), headRefName: "spike", baseRefName: "develop", ai: null });
    }
  }
  const open = (repo, n, daysOld, extra) => ({ repo, number: n, createdAt: new Date(now - daysOld * DAY).toISOString(),
    isDraft: false, reviewDecision: null, checks: "SUCCESS", headRefName: "feat", baseRefName: "develop", ...extra });
  const commits = Object.fromEntries(REPOS.map((repo, i) => [repo, Math.round(WEIGHT[i] * 14 + r() * 40)]));
  return {
    prs, commits, now, weeks, starts: weekStarts(now, weeks),
    reviews: { last30: 41, prev30: 38 },
    open: [
      open("acme/api", 2311, 0.3), open("acme/web", 1874, 1), open("acme/mobile", 642, 2),
      open("acme/billing", 388, 0.5, { checks: "FAILURE" }),
      open("acme/web", 1869, 3, { reviewDecision: "CHANGES_REQUESTED" }),
      open("acme/infra", 207, 1, { checks: "PENDING" }), open("acme/api", 2290, 4, { isDraft: true }),
      open("acme/docs", 95, 46, { checks: null }), open("acme/search", 51, 73, { checks: null }),
    ],
    reviewRequests: [
      { repo: "acme/api", number: 2306, createdAt: new Date(now - 0.4 * DAY).toISOString() },
      { repo: "acme/design-system", number: 133, createdAt: new Date(now - 1.5 * DAY).toISOString() },
    ],
  };
}
