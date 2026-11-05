# Your stats

A side panel with your own delivery numbers across every GitHub repo you open PRs in: PRs merged
per week and per day, what waits on you (review requests, failing checks, changes requested, PRs
ready to merge, stale PRs), median time to merge, Claude against Codex, PRs and commits per repo,
reviews of other people's PRs, and merge rate.

![Your stats (demo data)](preview.png)

## What you see

- **Header** (42 px, 1 px `border` bottom): "Your stats" in semibold, one status ("updated 4m ago",
  "Refreshing…", or "Couldn't refresh · numbers from 47m ago" in the warning color), and a Refresh
  button on `raised` (11 px, `hover` background), dimmed while a load runs. The first load leaves
  the status empty: the body says what is loading.
- **Key line:** only while the panel has the keyboard, "↑ ↓ move · Enter opens · R refreshes · Esc
  leaves" under the header in 10 px.
- **Readable colors** (`colors.js`): each theme color is lifted toward the foreground only when a
  theme sets it below its floor on `raised`. A see-through theme color is measured as it shows on
  its background. Labels 6:1; hints, good (`ansi2`), bad (`ansi1`) and warning (`ansi3`) 4.5:1;
  bars, the AI colors and the focus ring 3:1, the floor for non-text marks.
- **This week** (full width, `raised`, 8 px radius): the count at 30 px with "PRs merged", the pace
  in words ("15% behind your usual pace", "On your usual pace"), then "Heading for ~150 by Sunday ·
  usual week 176" in the hint color, then Monday to Sunday as bars with every value. Today is
  labelled "Today", with its value and label in the text color; future days draw nothing. The
  pace's tooltip names the usual week, the usual count by now and last week.
- **Waiting on you** (the second hero): "N open" at the right of the title opens your open PRs.
  Then up to four rows, each hidden at zero, with its count at 16 px: "Asked for your review",
  "Checks failing" (count in the bad color), "Changes requested", "Ready to merge" (count in the
  good color: checks pass, not a draft, no review blocking). A row of one PR names it and opens it;
  a row of more opens the matching GitHub search. Under a divider, "N stale · open over 30 days ·
  oldest gavematch#3, 181 days" opens them oldest first. "Nothing waits on you right now." when
  every row is zero.
- **Last 12 weeks:** 12 bars in `accent`, this week labelled "now", every value above its bar (1.2k
  past 999). This week's bar sits in a dashed outline up to where the week is heading, and its label
  names that estimate ("~150").
- **Last 30 days:** rows with the label and value on one line and the comparison under it: PRs
  merged, median time to merge, reviews of others' PRs. Comparisons are words and a percentage in
  the verdict color ("276 more (+53%)", "16m slower (+23%)"), then "than the 30 days before" in the
  hint color. A change under 10% stays neutral, as do reviews. Then one quieter line: "4,475 commits
  from your account in 14 repos · 96% merged of 831 PRs closed". Then "Claude vs Codex" with "99%
  with an AI mark": one split bar with 2 px gaps (Claude `#d4704f`, Codex `#a8cdf8` on dark cards
  and `#1d4f99` on light ones, so they differ in lightness too; Both as the two colors half and
  half; No AI mark in the hint color), and a table with each one's PRs and median time to merge.
- **By repo:** the top five repos by merged PRs, one bar each with no track (the longest bar is the
  scale), commits on hover; each row opens your PRs in that repo. "Show 9 more repos · 33 PRs"
  expands the list and "Show fewer repos" folds it. The owner shows only when two listed repos
  share a name.
- **Type scale:** 10 (chart labels, key line), 11 (secondary), 12 (pace, row labels), 13 (body and
  card titles), 16 (waiting counts), 30 (this week's count). Numbers group thousands by hand,
  because the runtime's `toLocaleString` does not.

## How it behaves

- Loads on open when the cached numbers are older than 30 minutes. A one-minute tick keeps
  "updated Nm ago" true and reloads once the numbers turn 30 minutes old. Refresh, R, or the
  `stats:refresh` key command (`herdr-app do stats.refresh`) reload now.
- Only the computed numbers go into shared state `stats.v4` (`{ at, stats }`), no PR texts.
- Errors show as a sentence that says what to do (`plainError` in `stats.js`): how to install `gh`,
  "Run gh auth login in a terminal, then refresh", the API limit, or no network. With numbers on
  screen they show in the warning color and the numbers stay at full opacity.
- `"focusable": true`: `pane.go` gives the panel the keyboard. Every clickable thing registers in
  reading order while the panel renders, with a role and a screen-reader label; ↑/↓ move a 2 px
  accent ring and mark that item `aria_active_descendant`, Enter or Space activates, R refreshes,
  ← and → run `pane.go` that way, and Escape runs `pane.go` toward the terminals: the side of the
  layout row where the terminal block sits (`layout()`), left when it cannot tell. Clicks open
  `https://github.com/` pages with `open`.
- Each chart is one `image` node with a sentence for screen readers ("PRs merged each day this
  week: Mon 15, Tue 27, …"); the pace and the AI table carry their tooltip facts as labels too.

## Built from

- One mod, `mods/stats`, `mod.json` `{ "place": "none", "title": "Your stats", "focusable": true }`, shown as a
  block in the side panel stack (`panel-body`) of a cloned layout, with a button in a cloned tab bar.
- `herdr` API: `exec` (`gh api graphql`, `open`), `run` (`pane.go`), `layout`, `readTextFile` and `appHome`
  (optional `stats.json`), `theme`, `shared` / `setShared`, `nextCommand`; elements `.tooltip`, `.role`,
  `.accessibility_label`, `.aria_active_descendant`, `overflow_y_scrollbar`.
- `stats.js` is pure (no `herdr` imports), so `node --test` covers the counting.
- GitHub: per account, 13 weekly `search(type: ISSUE)` windows of `is:pr author:<login> created:…`
  (search caps at 1,000 rows), with `body` and the last 15 commit messages only for the last 31
  days, plus one search for older PRs that closed inside the 91 days; one aliased query for review
  counts, your open PRs (draft, `reviewDecision`, the last commit's `statusCheckRollup`) and the
  open PRs that ask for your review; one aliased query for commit counts per repo with
  `history(since, author: { id })`.

## Watch out

- An app started from the Dock can miss Homebrew on `PATH`: fall back to `/opt/homebrew/bin/gh`.
- Search windows overlap by a day, and the old-PR search can meet a window; deduplicate by
  `repo#number` and keep the copy with AI marks.
- PR numbers repeat across repos, so never key by number alone.
- "Codex" in a PR body usually describes a Codex review: count only its "Generated with" line.

## Done when

- `herdr-app check mods/stats` passes and `node --test` passes.
- With `gh` logged in, the panel fills in within about 15 seconds and shows the same 30-day merged
  count as a GitHub search for `is:pr is:merged author:<you> merged:>=<30 days ago>` minus releases.
- Refresh shows "Refreshing…" in the header and then "updated just now".
- On a Thursday the week reads "On your usual pace" or "N% ahead of" / "behind your usual pace",
  never a raw drop against a whole week, and never in red.
- Every "Waiting on you" row, the stale line, "N open" and every repo row open on GitHub, and the
  keyboard reaches each of them in reading order.
- The kit has no way to scroll a plain scroll area from code, so the keyboard ring can sit below
  the fold; scroll with the wheel. A virtual list would scroll, but its rows take no click handlers.
