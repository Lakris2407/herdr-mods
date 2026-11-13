import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme as herdrTheme, window, shared, layout, settings } from "herdr";
import { roles, readable } from "./colors.js";

// herdr-mods: quiet text lifted to 4.5:1 on the tab bar (colors.js), and a working tab's spinner in
// the accent, as in the agents list.
function theme() {
  const t = herdrTheme(), r = roles(t, t.chrome);
  return { ...t, dim: r.hint, muted: r.sub, working: readable(t.accent, t.chrome, 4.5) };
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The side-panel buttons, in tab-bar order.
const PANELS = [
  ["files", "Files", "mods/files/file.svg"],
  ["changes", "Changes", "mods/changes/changes.svg"],
  ["github", "GitHub", "mods/github/github.svg"],
  ["stats", "Stats", "mods/stats/stats.svg"],
  ["runners", "Runners", "mods/runners/runners.svg"],
];
const HIDDEN = "tabs-plus.hidden";

// Right-click a panel button (or the ⋯ button) for the Controls menu: which buttons and status-bar
// blocks show. It writes HIDDEN.
const openPanelMenu = () => run("mod.open", { name: "controls" });

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      // herdr-mods: an automatic number ("1") says nothing: the agent's own title (its task, as in the
      // agents list), else the program. A name someone typed stays.
      const live = (lead?.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const telling = live && live !== program?.name && !/^[~/]/.test(live) && !live.includes("@");
      const automatic = /^tb\d+$/.test(c.name) || /^\d+$/.test(c.name);
      const name = automatic ? (telling ? live : program?.name ?? "Terminal") : c.name;
      // herdr-mods: an automatic name that repeats the program ("Claude Code") says what the
      // icon already says, so the tab is the icon alone and the name moves to the tooltip.
      const bare = automatic && Boolean(program?.icon) && name === program.name;
      const label = bare ? (c.zoomed ? "Z" : "") : c.zoomed ? `${name} Z` : name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .when(bare, el => el.tooltip(name))
        .when(label, el => el.child(div().max_w(170).truncate().child(label)))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(readable(t.dim, t.raised, 4.5)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const hidden = shared(HIDDEN) ?? [];
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "github", "stats", "runners"].filter(id => !hidden.includes(id));
    // A hidden button's panel closes too, so nothing is left open that you can't reach.
    if (panel && !panel.hidden && body?.active && PANELS.some(([id]) => id === body.active) && !enabled.includes(body.active)) run("layout.hide", { id: "panel" });
    this.syncPanel(space, panel, body, enabled);
    // herdr-mods: one side panel at a time. Skillshare has its own column; when it and the panel stack
    // are both open, the one opened earlier closes, so the terminal keeps its width.
    const ss = find(root, "skillshare-panel"), ssOn = Boolean(ss && !ss.hidden), pOn = Boolean(panel && !panel.hidden);
    if (ssOn && pOn) run("layout.hide", { id: this.ssWasOn ? "skillshare-panel" : "panel" });
    this.ssWasOn = ssOn && !(pOn && this.ssWasOn);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openPanelMenu(); })
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // herdr-mods: "+" before the first tab and outside the scrolling row, so it stays in one place and
      // in view with any number of tabs. A divider before the panel buttons keeps the two groups apart.
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).tooltip("New tab"))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(div().w(1).h(16).mx(4).flex_none().bg(t.border))
      .children(PANELS.filter(([id]) => enabled.includes(id)).map(([id, label, icon]) => panelButton(id, label, icon)))
      // With every button hidden, a small handle keeps the menu reachable.
      .when(!PANELS.some(([id]) => enabled.includes(id)), el => el.child(button("panels-menu", "⋯", () => openPanelMenu())))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-plus/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-plus/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-plus/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
