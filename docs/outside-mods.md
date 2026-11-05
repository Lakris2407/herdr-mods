# Notes for the mods outside this repo

A design review of the whole Herdr setup (2026-11-05) found problems in mods this repo does not hold:
Herdr's own `spaces`, `agents`, `github`, `workspace-status` and the `tabs-plus` clone. Herdr's mods are
read-only, so each fix needs a clone (`herdr-app do mod.clone '{"name":"spaces","as":"spaces-plus"}'`)
or a change upstream. The mods here already follow these rules; see [shared/colors.js](../shared/colors.js).

## Color: one meaning per color

Red means failed, offline or needs you now, and nothing else. Use `roles()` from `shared/colors.js`.

| Where | Now | Change to |
| --- | --- | --- |
| `spaces/main.js:367`, commits behind main (↓4) | red | `sub` text; the arrow carries the direction |
| `spaces`, commits ahead (↑) | green | `sub` text, so ↑ and ↓ differ by shape, not only by color |
| `agents`, the "Working" group | yellow, the same as a waiting job | the theme's `accent`; keep amber (`warn`) for "Needs you" |
| `github/ci.js:74`, CI failed | red | keep: this is a failure |
| `spaces`, `agents`, `workspace-status`, `github` panel | raw `t.dim` (3.14:1 on chrome, 2.78:1 on a panel) | `roles(t, bg).hint` (4.5:1) |

## Sidebar: say what the space is before its ID

- Worktree spaces show a generated name such as `20261105-131844-29722` in full and cut the repo to
  "blockt…". Show the repo and the task or branch first; put the timestamp in the tooltip.
- The avatar is the first character of the name (`spaces/main.js:421`), so two worktree spaces both
  show "2". Use the repo's initial and color.
- Agent rows cut both the space and the task ("Serve…", "Dinfi…"). Show the task first, the space
  second. Hide the program icon when every agent runs the same program.
- The Spaces list takes half the height and is mostly empty. Size it to its rows, so Agents gets the room.

## Status bar

- `workspace-status`: at weight 1.7 and `min` 90 only the branch icon shows. Give the block `min` 160,
  or let the branch name shrink before the icon.
- `github` CI view: with no pull request it still draws an empty bar at weight 0.8. Draw nothing, and
  let the layout give the room to the others.
- Order: what needs you on the left, telemetry on the right (see the [README](../README.md#one-time-setup)).

## Tab bar and panels

- `tabs-plus`: the tab list takes all free room (`flex_1`), so the new-tab "+" lands beside the panel
  buttons (`tabs-plus/main.js:112-114`) and reads as "add a panel". Put "+" inside the tab row right
  after the last tab, then a spacer, a divider and the panel buttons.
- Skillshare has its own fixed 118 px toggle and its own column in `main-plus.json` (`skillshare-toggle`,
  `skillshare-panel`), with a color logo. Move it into `panel-body` beside the others, with a one-color
  icon, so one panel shows at a time and the terminal keeps its width.
- `github` panel: with nothing open, hide the sort, label and search controls above "No open pull
  requests". Its Refresh is plain text; the other panels draw it as a button with an edge.

## Not a fix: `minimum_contrast`

`settings.json` has `"minimum_contrast": 1.0`. This setting changes terminal text only, not the
sidebar, the bars or the panels, and above about 3 it turns dim terminal text near-white. It does not
fix the problems above.
