// The status-bar chip: a square per runner slot and what waits. Click: show or hide the Runners panel,
// like the tab bar's button (the popup when the layout has no panel for it). Right-click: the popup.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, openOverlay, layout, run, settings } from "herdr";
import { readable } from "./colors.js";
import { snapshot } from "./poll.js";
import { slots, summary, waiting, running, chipWords } from "./model.js";
import { squares, colors, ink } from "./ui.js";

const ROW = 30;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export class Chip {
  init(_props, cx) {
    this.handle = cx.focus_handle();
  }

  // pane.go can land on the chip too: Enter does what a click does, Space what a right-click does.
  focus() {
    this.handle.focus();
  }

  key(e, cx) {
    const k = e.keystroke;
    if (k === "enter") this.toggle();
    else if (k === "space") this.open();
    else if (k === "escape") run("pane.go", { direction: "up" });
    else if (["up", "left", "right"].includes(k)) run("pane.go", { direction: k });
    else return;
    cx.stop_propagation();
  }

  open() {
    const s = snapshot();
    const rows = s ? Math.min(6, waiting(s).length) + Math.min(6, running(s).length) + s.machines.length : 3;
    openOverlay({ mod: "runners", kind: "popup", width: 420, height: Math.min(640, 150 + rows * ROW), props: { view: "popup" } });
  }

  toggle() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !find(body, "runners")) return this.open();
    if (!panel.hidden && body.active === "runners") run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: "runners" }); run("layout.show", { id: "panel" }); }
  }

  render() {
    const t = theme(), s = snapshot(), c = colors(t, t.chrome);
    const bar = h_flex().id("runners-chip").size_full().px(10).gap(8).overflow_hidden().items_center().cursor_pointer()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .hover((e) => e.bg(t.hover)).on_click(() => this.toggle()).on_mouse_down("right", () => this.open())
      .tooltip("Runners · click: panel · right-click: quick look")
      .role("button").accessibility_label("Runners: Enter shows the panel, Space a quick look")
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .when(this.handle.is_focused(), (e) => e.border_2().border_color(readable(t.accent, t.chrome, 3)));
    if (!s) return bar.child("Runners").child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900));
    const sum = summary(s), offline = slots(s).filter((r) => r.status === "offline").length;
    const words = chipWords(sum, offline);
    // Narrow status bar: drop the title, then the squares. The words keep their nouns at any width:
    // the squares say less than "4 jobs waiting".
    const groups = s.machines.filter((m) => m.runners.length).map((m) => squares(m.runners, t, t.chrome));
    const need = sum.total * 8 + groups.length * 5 + (words.state.length + words.offline.length) * 6, w = this.width ?? Infinity;
    const full = w >= 90 + need, squaresFit = w >= 30 + need;
    const state = !words.state ? null : sum.waiting ? div().flex_none().text_color(c.wait).child(words.state)
      : div().flex_none().when(!sum.busy, (e) => e.text_color(ink(t, t.chrome).hint)).child(words.state);
    return bar.on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (w !== this.width) { this.width = w; cx.notify(); } })
      .when(full, (e) => e.child("Runners"))
      .when(squaresFit, (e) => e.child(h_flex().gap(5).items_center().children(groups))).when(Boolean(state), (e) => e.child(state))
      .when(offline > 0, (e) => e.child(div().flex_none().text_color(c.off).child(words.offline)))
      // A failed read says so in words when there is room; the tooltip names what failed.
      .when(Boolean(s.error), (e) => e.child(div().id("chip-error").text_color(c.off).tooltip(`Last read failed: ${s.error}`)
        .child(squaresFit ? "read failed" : "!")));
  }
}
