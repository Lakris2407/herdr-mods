# Changes to Herdr's own mods

A design review of the whole Herdr setup (2026-11-05) found problems in mods this repo does not hold:
Herdr's own `spaces`, `agents`, `github` and `workspace-status`, and the `tabs-plus` clone. Herdr's
mods are read-only and carry no license, so this repo does not ship copies of them. This page says how
to make the same clones and what to change in each. A clone is yours and Herdr never updates it.

## Make the clones

```sh
for m in spaces agents github workspace-status; do
  herdr-app do mod.clone "{\"name\":\"$m\",\"as\":\"$m-plus\"}"
  cp shared/colors.js ~/.config/herdr-app/mods/$m-plus/colors.js
done
cp shared/colors.js ~/.config/herdr-app/mods/tabs-plus/colors.js
```

In `~/.config/herdr-app/layouts/main-plus.json`, point each block at its clone (`spaces-plus`,
`agents-plus`, `github-plus` for both the panel and the `status-ci` block, `workspace-status-plus`).
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

- The theme wrapper above: `t.dim` was 3.14:1 on the sidebar.
- Ahead (↑) and behind (↓) use `t.muted`, not green and red. Being behind main is not a failure, and
  the arrow carries the direction.
- A space named by a worktree tool (`20261105-131844-29722`) shows its repo instead, with the branch
  after it, or the time it was made (`13:18`) when the branch is main. The full name is in the tooltip,
  and the avatar takes the repo's initial.
- The avatar letter is white or the theme's background, whichever reads better on its color.

## agents-plus

- The theme wrapper, plus `working: readable(t.accent, t.chrome, 4.5)`: "Working" and its spinner take
  the accent, so they no longer share amber with a job that waits. "Needs you" keeps `t.blocked`.
- In the priority view a row shows the task first, then `· space`.
- When every agent runs the same program, the rows drop the program icon.

## github-plus

- `panel.js`: the theme wrapper on `t.background`. Refresh is a raised button, like the Runners and
  Stats panels. Sort, labels and search show only when there is a list to narrow, or a filter is on.
- `ci.js`: the theme wrapper with `ansi1: r.fail, ansi2: r.ok` and `working` in the accent.

## workspace-status-plus

- The theme wrapper.
- It measures its width (`on_size_change`) and keeps parts in this order: the branch (shortened,
  never dropped), the agents and who needs you, the machine from 330 px, the palette hint from 440 px.
  Before, every part shrank at once and only icons were left. The dot turns `t.blocked` when an agent
  needs you.

## tabs-plus

- The theme wrapper, plus `working` in the accent.
- "+" sits inside the tab row, right after the last tab, with a "New tab" tooltip; a 1 px divider in
  `t.border` comes before the panel buttons. Before, the tab row took all free room and "+" landed
  beside the panel buttons, so it read as "add a panel".
- One side panel at a time: when the panel stack and Skillshare's own column are both open, the one
  opened earlier closes. Skillshare tracks its own `skillshare-panel` node, so moving it into
  `panel-body` would mean changing that mod too.

## Not changed

- `minimum_contrast` in `settings.json` changes terminal text only, not the sidebar, the bars or the
  panels, and above about 3 it turns dim terminal text near-white.
- The CI block keeps its weight when there is no pull request: a layout cannot give its room away
  while the app runs, and hiding it would clash with the Controls menu.
