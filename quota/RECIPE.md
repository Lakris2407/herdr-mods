# Agent quota

A slim strip at the right end of the status bar that shows each coding agent's usage limits as
small bars: Claude's 5-hour and weekly limits side by side, Codex's weekly limit, and any other
provider `quota-axi` reports. It stays grey and green until a limit gets high. A click opens a
popup with reset times, pace and options. The popup header identifies whether percentages
are used or remaining.

![Agent quota](preview.png)

## What you see

- **Status strip** (28 px tall, 360 px wide, right-aligned, `chrome` background, 1 px `border`
  top line, matching the shipped `workspace-status` beside it). Per provider, left to right:
  - the provider's icon, 12 px (Claude tinted `#d97757`, Kimi `#1783ff`, Copilot `#8f6bf2`;
    others from the app's program table: a tinted glyph or the full-color image);
  - per shown limit: a 10 px `dim` label (`5h`, `wk`, `mo`, or the first word of the limit's
    label when a provider has two of one kind), a 34×4 px rounded track (`border`) with the
    used share filled, and the percent (11 px, `muted` below 60%, else the level color);
  - a 1×12 px `border` divider between providers.
- **Level colors** (dark / light theme): below 60% `#5ed49a` / `#1f9d63`, from 60% `#f2c14e` /
  `#c98a0b`, from 80% `#f59152` / `#dd6b20`, from 92% `#f2665c` / `#d64545`.
- **Pace tick:** a 1 px line, `foreground` at 45% opacity, 2 px taller than the track on each
  side, at the share of the window that has passed.
- **Popup** (300 px wide, `popover`): "Agent quota · updated Nm ago" and a Refresh link; per
  provider its icon, name in semibold and plan in `dim`; per limit a 62 px label ("5 hours",
  "Week", or the limit's label), a 120×5 px bar, the percent, and below it "resets in 2h 52m ·
  39% under pace". A divider, then "Limits to show in the status bar" with 32 px menu rows:
  labels on the left (`foreground` when selected, `muted` otherwise), a 16 px Lucide check
  in `accent` on the right when selected, and a hover background. Options: 5-hour limit,
  Weekly limit, Monthly limit, Model limits, then a 1 px `border` divider with 6 px vertical
  margins and a "Providers" heading before the provider list, Signed-out providers
  and Provider names.

## How it behaves

- Reads every 2 minutes, at start, and on Refresh or the `quota:refresh` key command.
- Follows the selected space's machine (`spaces().find(s => s.active).machine`, null locally).
  Both `quota-axi` and its login-shell fallback pass `{ on: machine }` to `exec`. Switching
  machines reads immediately. Results, errors and pending requests are isolated by machine;
  late replies never replace the newly selected machine's data. Never fall back to local execution.
- The popup shows the machine name and pins that machine in its props. Its Refresh runs there
  even after the selected space changes. Each remote needs its own `quota-axi` and CLI sign-ins.
- Data older than 10 minutes fades the strip to 60% opacity.
- A small ▲ (8 px, level color) follows the percent when usage is at least 20% and 10 points
  ahead of pace. The popup says "on pace" within 5 points.
- Hovering a provider shows a tooltip: each limit's percent and time to reset.
- Click or right-click the strip, or the `quota:menu` key command, opens the popup at the pointer.
  Checkbox clicks apply at once and keep the popup open; Esc or a click outside closes it.
- Defaults: 5-hour, weekly and monthly limits on, model limits off, signed-out providers and
  names off. Layout `props` (`hidden`, `kinds`, `signedOut`, `names`, `remaining`) set the start; popup
  choices are saved in shared state `quota.options` and win.
- No agent status colors are used; it does not depend on agents running.
- **Show remaining instead of used** toggles `remaining` in `quota.options` (default false).
  Both views invert percentages, fills and pace ticks; the popup labels the selected mode.
  Colors and pace warnings still use percent used. `shareOf` windows stay in used mode.

## Built from

- One mod, `mods/quota`, `mod.json` `{ "place": "none" }`. The same mod draws the popup when
  `props().menu` is set (`openOverlay({ mod: "quota", kind: "popup", width: 300, props: { menu: true, machine, start } })`).
- Layout: the status block becomes a row: `workspace-status` (weight 1) and `quota` (px 360),
  `resizable: false`.
- `herdr` API: `spaces`, `exec`, `theme`, `settings().dark`, `shared` / `setShared`
  (`quota.data:<JSON machine>`, `quota.error:<JSON machine>`, global `quota.options`), `props`,
  `openOverlay`, `knownAgents` (icons), `nextCommand`; elements `svg`, `image`, `.tooltip`.
- Program: `quota-axi --json` (`providers[].provider/label/plan/windows[]` with
  `kind` session, weekly, monthly or model, `percentUsed` or `percentRemaining`, `resetsAt`, `windowSeconds`).
  When `percentUsed` is absent, derive it as `100 - percentRemaining`; never derive it for a
  `shareOf` window or treat missing percentages as zero usage.

## Watch out

- An app started from the Dock often lacks the npm global bin on `PATH`; fall back to
  `"$SHELL" -lic "quota-axi --json"` and parse from the first `{` (a shell banner can come first).
- Shipped icons differ: some are one-color glyphs, some full-color; Codex's has a white tile.
  Use the program table's `tint` to choose `svg` or `image`.
- Cursor reports three monthly limits with a past reset time; hide "resets in" when it is past.
- The strip has a fixed width; names on or many providers cut off its left end.

## Antigravity window preference

After the provider list, add an Antigravity: Claude/GPT limits checkbox when `agy` is reported.
Persist `agyClaudeGpt` with the existing options; missing means enabled. Hide only
`agy` windows whose ids begin with `claude_gpt_` when false, in both the strip and
popup details. Keep all windows cached so toggling back works immediately. Keep
provider and kind filters independent. Validate with `node --test tests/quota-windows.test.mjs`.

## Done when

- `herdr-app check mods/quota` passes.
- The strip shows Claude with a `5h` and a `wk` bar and Codex with a `wk` bar, with percents
  that match `quota-axi`.
- Clicking the strip opens the popup with reset times and pace; unticking "5-hour limit"
  removes the `5h` bar at once.
- With `quota-axi` missing, the strip says "Quota unavailable" and the popup shows the error.

## Windows command compatibility

Before the existing Unix login-shell fallback, try the fixed command
`cmd.exe /d /s /c "quota-axi --json"` only if the native executable cannot start.
Forward the same execution options to both attempts, including a remote machine when
provided. Do not interpolate caller input into the shell command or retry a CLI that
already ran and returned a nonzero exit code. Keep the original spawn error if neither
launcher starts. Check the helper with `node --test tests/quota-command.test.mjs`.
