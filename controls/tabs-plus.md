# Tab bar: panel buttons that Controls can hide

Controls turns status-bar blocks off and on by itself. The side-panel buttons are drawn by the tab bar,
so the tab bar must leave out the ones you turned off. Herdr's own tab bar is read-only, so this is a
patch for your clone of it, `tabs-plus` (see the [one-time setup](../README.md#one-time-setup)). All
edits are in `~/.config/herdr-app/mods/tabs-plus/main.js`.

With it, right-click any panel button for the Controls menu. Hiding the button of the open panel closes
that panel. With every button hidden, a small `⋯` button stays so the menu is always reachable.

## 1. Above the class

List your panel buttons once, in tab-bar order. Use the ids of your `panel-body` children:

```js
// The side-panel buttons, in tab-bar order.
const PANELS = [
  ["files", "Files", "mods/files/file.svg"],
  ["changes", "Changes", "mods/changes/changes.svg"],
  ["runners", "Runners", "mods/runners/runners.svg"],
];
const HIDDEN = "tabs-plus.hidden";

// Right-click a panel button (or the ⋯ button) for the Controls menu. It writes HIDDEN.
const openPanelMenu = () => run("mod.open", { name: "controls" });
```

## 2. In `render()`

Where `enabled` is built, leave out hidden buttons and close a panel whose button was hidden:

```js
const hidden = shared(HIDDEN) ?? [];
const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "runners"].filter(id => !hidden.includes(id));
// A hidden button's panel closes too, so nothing is left open that you can't reach.
if (panel && !panel.hidden && body?.active && PANELS.some(([id]) => id === body.active) && !enabled.includes(body.active)) run("layout.hide", { id: "panel" });
```

In `panelButton`, open the menu on a right-click:

```js
.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openPanelMenu(); })
```

Replace the separate `panelButton(...)` children with one list, plus the `⋯` fallback:

```js
.children(PANELS.filter(([id]) => enabled.includes(id)).map(([id, label, icon]) => panelButton(id, label, icon)))
// With every button hidden, a small handle keeps the menu reachable.
.when(!PANELS.some(([id]) => enabled.includes(id)), el => el.child(button("panels-menu", "⋯", () => openPanelMenu())))
```

Import `shared` from `"herdr"` if it is missing. Then run `herdr-app check ~/.config/herdr-app/mods/tabs-plus`.
