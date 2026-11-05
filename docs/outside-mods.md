# Changes to Herdr's own mods

Two design reviews of the whole Herdr setup (2026-11-05) found problems in mods this repo does not
hold: Herdr's own `spaces`, `agents`, `github`, `workspace-status`, `pane` and `workspace-chrome`, the
`tabs-plus` clone, and the Skillshare mod. Herdr's
mods are read-only and carry no license, so this repo does not ship copies of them. This page says how
to make the same clones and what to change in each. A clone is yours and Herdr never updates it.

## Make the clones

```sh
for m in spaces agents github workspace-status pane workspace-chrome; do
  herdr-app do mod.clone "{\"name\":\"$m\",\"as\":\"$m-plus\"}"
  cp shared/colors.js ~/.config/herdr-app/mods/$m-plus/colors.js
done
cp shared/colors.js ~/.config/herdr-app/mods/tabs-plus/colors.js
cp shared/colors.js ~/.config/herdr-app/mods/skillshare/colors.js
for m in spaces workspace-status pane; do cp shared/names.js ~/.config/herdr-app/mods/$m-plus/names.js; done
```

[shared/names.js](../shared/names.js) names a space the same way in every list: a worktree tool's
space "20261105-183951-57367" on branch `cw/Dinfirmaadresse-20261105-183951-57367` reads
"Dinfirmaadresse 18:39". spaces-plus writes each space's name to `shared("space.labels")`
(`{ <space id>: { name, when } }`), and the other clones read it there.

In `~/.config/herdr-app/layouts/main-plus.json`, point each block at its clone (`spaces-plus`,
`agents-plus`, `github-plus` for both the panel and the `status-ci` block, `workspace-status-plus`,
`workspace-chrome-plus` for the brand row and the sidebar footer, `pane-plus` for the pane header).
Give the `skillshare-toggle` block 84 px.
Give `status-main` a `min` of 160, and the sidebar lists `spaces` weight 1 and `agents` weight 2, so the
agents get the room.

Each clone below starts the same way: it wraps the theme so the quiet text reads, using
[shared/colors.js](../shared/colors.js).

```js
import { theme as herdrTheme } from "herdr";
import { roles, readable } from "./colors.js";
function theme() {
  const t = herdrTheme(), r = roles(t, t.chrome); // t.background for the GitHub panel
  return { ...t, dim: r.hint, muted: r.sub };
}
```

## spaces-plus

- The theme wrapper above, on `t.selected`, not `t.chrome`: the selected row is the lightest fill a
  row takes, so the quiet text reads there, on a hovered row and on the sidebar. On `t.chrome` it was
  3.47:1 on the selected row.
- Ahead (↑) and behind (↓) use `t.muted`, not green and red. Being behind main is not a failure, and
  the arrow carries the direction.
- A space named by a worktree tool (`20261105-131844-29722`) shows its repo instead, with the branch
  after it, or the time it was made (`13:18`) when the branch is main. The full name is in the tooltip,
  and the avatar takes the repo's initial.
- The branch drops the tool prefix and the repo (`branchTail` in names.js): `cw/Dinfirmaadresse-<stamp>`
  says no more than the repo, so the time shows in its place. Before, two worktrees of one repo both
  read "Dinfirmaadresse · cw/Dinfirmaadress…".
- A worktree space takes the color of the first space of its repo, once (`localStorage`
  `spaces.repoHue`), so the spaces of one repo read as one family. A color picked later stays.
- The avatar letter is white or near-black (`#15161c`), whichever reads better on its color. The
  theme's background was 4.2:1 on the blue and pink avatars.
- It writes each space's name to `shared("space.labels")` for the other lists.

## agents-plus

- The theme wrapper on `t.selected` (as in spaces-plus), plus `working: readable(t.accent, t.chrome,
  4.5)`: "Working" and its spinner take the accent, so they no longer share amber with a job that
  waits. "Needs you" keeps `t.blocked`.
- In the priority view a row shows the task first, then `· space`. The task takes the free width;
  the space is a hint of at most 80 px, named from `shared("space.labels")` (not "202…"), and goes
  when the task starts with it ("Dinfirmaadresse.dk pricing page"). A group header in the grouped view
  adds the time ("Dinfirmaadresse · 18:39").
- When every agent runs the same program, the rows drop the program icon.

## github-plus

- `panel.js`: the theme wrapper on `t.background`. Refresh is a raised button, like the Runners and
  Stats panels. The count on the selected PRs or Issues chip is lifted again on `t.selected` (it was
  3.43:1). Sort, labels and search show only when there is a list to narrow, or a filter is on.
- `ci.js`: the theme wrapper with `ansi1: r.fail, ansi2: r.ok` and `working` in the accent.

The Issues tab, after a critique of a bot-heavy backlog (45 open, 8 of them `[grafana]` alerts):

- `issues.js` (new, pure): issues that share a leading `[tag]` (two or more) fold into one row,
  "grafana · 8 issues · github-actions · 7 P1 1 P2", placed where its first issue was. It opens in
  place; the issues inside drop the tag from their titles and the repeated author.
- "No bots" in the filter bar, once a bot has filed something: `-author:<login>` for each bot login
  seen in the repo (`is_bot`, or an `app/` login), so GitHub's 50 are all people's.
- Titles take the full width and wrap. The Agent button moved to the meta line and shows only on
  the row under the pointer or the keyboard cursor; its tooltip names the right-click shortcut.
- Labels: the `P0`-`P3` label leads in its own color (P0 `fail`, P1 `hot`, P2 `warn`, P3 `sub`), so
  red still means act now. The other labels are quiet words, at most two, then "+N". The issue
  number is quiet text, not the accent.
- A failed refresh with a list on screen shows a `warn` banner: "Last refresh failed 2m ago ·
  showing older data", with the error below. Before, the old rows stayed with no sign.
- The keyboard, with Runners' `keys.js` and `"focusable": true` in `mod.json`: ↑ ↓ (or J K) move,
  Enter opens (or folds a group), A starts an agent, Shift-A the quick menu, / goes to search, P and I
  switch tabs, R refreshes, Esc leaves. A click in the list gives the panel the keyboard.
- A full list's count reads "50+".

## workspace-status-plus

- The theme wrapper.
- The branch goes through `branchLabel` (names.js): `cw/Dinfirmaadresse-<stamp>` reads "worktree
  19:44"; the tooltip keeps the whole branch. Padding 12 and gap 10, so "main · 5 agents" fits at
  weight 1.9.
- It measures its width (`on_size_change`) and keeps parts in this order: the branch (shortened,
  never dropped), the agents and who needs you, the machine from 330 px, the palette hint from 440 px.
  Before, every part shrank at once and only icons were left. The dot turns `t.blocked` when an agent
  needs you.

## tabs-plus

- The theme wrapper, plus `working` in the accent. The active tab's close icon is lifted on
  `t.raised` (it was 2.9:1).
- A tab with an automatic number ("1") shows its agent's title (its task), else the program. A
  name someone typed stays.
- "+" sits inside the tab row, right after the last tab, with a "New tab" tooltip; a 1 px divider in
  `t.border` comes before the panel buttons. Before, the tab row took all free room and "+" landed
  beside the panel buttons, so it read as "add a panel".
- One side panel at a time: when the panel stack and Skillshare's own column are both open, the one
  opened earlier closes. Skillshare tracks its own `skillshare-panel` node, so moving it into
  `panel-body` would mean changing that mod too.

## pane-plus

- The theme wrapper on `t.background`: the folder was 3.06:1.
- The header shows the folder's own name, not the whole path; the full path is in the tooltip. A
  worktree tool's folder ("20261105-194444-50813") shows the space's name instead.

## workspace-chrome-plus

- The theme wrapper on `t.chrome`: "Add machine" was 3.62:1.

## skillshare

Skillshare is not Herdr's; these edits are in place, so an update of the mod takes them away.

- The tab-bar toggle reads "Skills" with a one-color icon (`icons/skills.svg`, the mark in
  `currentColor`), like the panel buttons beside it.
- A kind with nothing in it (Agents 0, MCP 0, Plugins 0) gets no segment, and with one kind left the
  control goes.
- When something needs an update or a sync, "In sync" folds to its header (click to open). Alone,
  it stays open and reads "All in sync · 20".
- The "this computer" pill's text is lifted on its own fill (4.1:1), and the filter's edge takes
  `roles().line` (it was 1.1:1).

## Not changed

- `minimum_contrast` in `settings.json` changes terminal text only, not the sidebar, the bars or the
  panels, and above about 3 it turns dim terminal text near-white.
- The CI block keeps its weight when there is no pull request: a layout cannot give its room away
  while the app runs, and hiding it would clash with the Controls menu.
