# Your stats

A side panel with your own delivery numbers across every GitHub repo you open PRs in: PRs merged
per week and per day, median time to merge, open PRs, how many of your merged PRs were made with
Claude or Codex, PRs and commits per repo, reviews of other people's PRs, and merge rate.

![Your stats (demo data)](preview.png)

## What you see

- **Header** (42 px, 1 px `border` bottom): "Your stats" in semibold, "updated 4m ago", and a
  bordered Refresh button (11 px, `hover` background), as in the runners panel.
- **Readable text:** labels use `muted` and hints use `dim`, each lifted toward the foreground only
  when a theme sets it below 6:1 (labels) or 4.5:1 (hints) on `raised` (`colors.js`). The good and
  bad colors (`ansi2`, `ansi1`) get the same 4.5:1 floor.
- **Tiles** (2 × 2, `raised`, 8 px radius, rows stretched to equal height). Every tile has the same
  four slots: label, value, comparison, context.
  - Merged this week: pace against your usual week (▲ 12% ahead of pace, • on pace, ▼ 15% under
    pace), then "~149 by Sun · 665 commits". The tooltip names the usual week and last week.
  - Merged · 30 days: ▲/▼ versus the prior 30, then the daily average.
  - Time to merge: ▲/▼ versus the prior 30, where less is green; then "median · 30 days".
  - Open PRs: the oldest in days, then its `repo#number` (full name on hover).
  - Comparisons have one format: the glyph and amount in the verdict color, "vs prior 30" in the
    hint color.
- **PRs merged per week:** 12 bars in `accent`, older weeks at 75% opacity, this week labelled
  "now", every value above its bar (1.2k past 999). This week's bar sits in a dashed `accent`
  outline up to where the week is heading.
- **This week, day by day:** Monday to Sunday with every value; a past day with no merges is a 2 px
  hint-colored bar, a future day a 1 px `border` line.
- **AI share:** the percent (rounded down) at the right of the title, "N of N merged PRs made with
  AI" below it, one split bar with 2 px gaps (Claude `#d4704f`, Codex `#3f86e0`, Both as the two
  colors half and half, No AI mark in the hint color) and a legend with counts, so color is never
  the only label.
- **By repo:** the top five repos by merged PRs, one bar each in `accent`, commits on hover, then
  "N more repos · N PRs". The owner shows only when two listed repos share a name.
- **Commits, reviews, merge rate:** rows for your commits (in how many repos, 30 days), reviews of
  others' PRs (▲/▼ versus the prior 30) and merge rate ("N closed or merged · 90 days").
- **Type scale:** 10 (chart labels), 11 (secondary), 12 (repo names), 13 (body and card titles),
  22 (tile values). Numbers group thousands by hand, because the runtime's `toLocaleString` does not.

## How it behaves

- Loads on open when the cached numbers are older than 30 minutes, checks every 5 minutes, and
  reloads on Refresh or the `stats:refresh` key command (`herdr-app do stats.refresh`).
- Only the computed numbers go into shared state `stats.v2` (`{ at, stats }`), no PR texts.
- Errors (for example "Run gh auth login first", or how to install `gh` when it is missing) show in
  `ansi1` above the last numbers. Numbers older than 30 minutes, after a failed reload, show at 60%
  opacity, as in the quota mod.

## Built from

- One mod, `mods/stats`, `mod.json` `{ "place": "none", "title": "Your stats" }`, shown as a
  block in the side panel stack (`panel-body`) of a cloned layout, with a button in a cloned tab bar.
- `herdr` API: `exec` (`gh api graphql`), `readTextFile` and `appHome` (optional `stats.json`),
  `theme`, `shared` / `setShared`, `nextCommand`; elements `.tooltip`, `overflow_y_scrollbar`.
- `stats.js` is pure (no `herdr` imports), so `node --test` covers the counting.
- GitHub: per account, 13 weekly `search(type: ISSUE)` windows of `is:pr author:<login>` (search
  caps at 1,000 rows), with `body` and the last 15 commit messages only for the last 31 days; one
  aliased query for review counts and open PRs; one aliased query for commit counts per repo with
  `history(since, author: { id })`.

## Watch out

- An app started from the Dock can miss Homebrew on `PATH`: fall back to `/opt/homebrew/bin/gh`.
- Search windows overlap by a day; deduplicate by `repo#number` and keep the copy with AI marks.
- PR numbers repeat across repos, so never key by number alone.
- "Codex" in a PR body usually describes a Codex review: count only its "Generated with" line.

## Done when

- `herdr-app check mods/stats` passes and `node --test` passes.
- With `gh` logged in, the panel fills in within about 15 seconds and shows the same 30-day merged
  count as a GitHub search for `is:pr is:merged author:<you> merged:>=<30 days ago>` minus releases.
- Refresh shows "Loading…" and then "updated just now".
- On a Thursday the week tile reads "on pace", "ahead of pace" or "under pace", never a raw drop
  against a whole week.
