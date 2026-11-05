# Controls

One menu to turn any status-bar block, any tab-bar button and any side-panel button off and on: a
small sliders button at the right end of the status bar opens it, and so do `cmd-shift-,` and a
right-click on a panel button.

![Controls](preview.png)

## What you see

- **Button** (status row, 30 px, min 30 px): a 14 px sliders icon in `dim` in a 22 px square with a
  6 px radius; `hover` background and `foreground` icon on hover. Tooltip: `Turn mods on or off`.
- **Menu** (popup, 240 px wide, `44 + 24 × sections + 28 × rows` px high, at most 640, scrolls):
  `popover` background, 6 px padding, 12 px text. Heading `Status bar` (11 px, `dim`), then one 28 px row per
  mod block of the status row: a 14 px column with an `accent` `✓` when shown, then the name in
  `foreground` (shown) or `dim` (hidden). Heading `Tab bar buttons`, then one row per mod block of
  the `tabs-row` row other than the `tabs` block. Heading `Side panel buttons`, then one row per
  child of the `panel-body` stack. Last line (11 px, `dim`): `A hidden block stops its work at the next start.`
  A layout without a status row, tab-row buttons or panel stack leaves that section out.
- Names: Workspace, GitHub, System load, Agent quota, Runners, Stats, Skills (`skillshare`), Files,
  Changes, Path menu; any other mod shows its folder name with dashes as spaces and a capital first letter. A `view` prop
  other than `chip` is added (`GitHub CI`).

## How it behaves

Click a status row: `layout.hide` or `layout.show` with the block's id, at once. Herdr keeps that in
`layouts/.state/`, so it stays after a restart. Click a tab-bar row: the same, and hiding it also
runs `layout.hide` on the column `<mod>-panel` if the layout has one (Skillshare's
`skillshare-panel`), so no panel stays open without its button. Click a panel row: adds or removes
its id in the shared list `tabs-plus.hidden`; a tab bar patched with [tabs-plus.md](tabs-plus.md) leaves those
buttons out and closes the panel when its button goes. The menu redraws from the live layout, so a
change made elsewhere shows at once. Controls never lists its own block, so the menu stays reachable.

## Built from

`mods/controls/main.js` picks the view: `props().view === "button"` draws the button, anything else
the menu (so `mod.open:controls` and `mod.json`'s popup overlay, 240×420, show the menu).
`controls.js` is pure: `find`, `label`, `items(root, buttons)` (status children with a `content.mod`
other than `controls`, with `on: !hidden`; `tabs-row` mod children but `tabs`, with `panel` when a
`<mod>-panel` node exists; `panel-body` children with `on` from the list), `toggle`.
Herdr: `layout`, `run` (`layout.hide`, `layout.show`, `mod.open`), `shared`, `setShared`,
`openOverlay`, `props`, `theme`. Art: `controls.svg`, two sliders, 1.5 stroke, `currentColor`.

## Watch out

- A hidden block's mod keeps its timers until the next start; it only stops polling once Herdr
  starts with it hidden. Say so in the menu rather than promise more.
- Do not keep your own list of hidden blocks: Herdr already saves shown and hidden per layout, and a
  second list goes out of step when someone uses `layout.toggle` elsewhere.
- Panel buttons belong to the tab bar, so Controls can only ask it to hide them; Herdr's own tab bar
  ignores `tabs-plus.hidden`.
- Find the status row, tab row and panel stack by the ids `status`, `tabs-row` and `panel-body`, as
  in Herdr's `main`. Never list the `tabs` block: without it nothing can open a panel.

## Done when

`herdr-app check` passes and `npm test` passes; the button opens the menu with every status block but
Controls itself; clicking the Skills row hides the Skills button and its open panel; clicking a status
row hides its block at once and it is still hidden after a restart; clicking a panel row removes its button from a patched `tabs-plus`; `cmd-shift-,` opens the menu.
