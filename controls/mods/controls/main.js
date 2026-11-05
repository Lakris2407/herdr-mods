// Controls: one menu to turn off any status-bar block and any side-panel button.
// In the status row (props `{ "view": "button" }`) it draws a small sliders button that opens the menu;
// anywhere else (`mod.open:controls`, a popup) it draws the menu. Herdr keeps shown and hidden in
// layouts/.state/, so a choice stays after a restart.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, layout, run, shared, setShared, openOverlay, props } from "herdr";
import { items, toggle } from "./controls.js";
import { roles } from "./colors.js";

const BUTTONS = "tabs-plus.hidden"; // panel buttons the tab bar leaves out (see tabs-plus.md)
const ROW = 28;

function openMenu() {
  const { status, panels } = items(layout(), shared(BUTTONS) ?? []);
  const rows = status.length + panels.length;
  openOverlay({ mod: "controls", kind: "popup", width: 240, height: Math.min(640, 92 + rows * ROW) });
}

function row(t, id, text, on, click) {
  const r = roles(t, t.popover);
  return h_flex().id(id).h(ROW).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_click(click)
    .child(div().w(14).text_color(t.accent).child(on ? "✓" : ""))
    .child(div().min_w(0).truncate().text_color(on ? t.foreground : r.hint).child(text));
}

const heading = (t, text) => div().px(8).pt(6).pb(2).text_size(11).text_color(roles(t, t.popover).hint).child(text);

function menu(t) {
  const buttons = shared(BUTTONS) ?? [];
  const { status, panels } = items(layout(), buttons);
  return v_flex().id("controls-menu").size_full().p(6).gap(1).bg(t.popover).text_size(12).text_color(t.foreground).overflow_y_scrollbar()
    .when(status.length > 0, (e) => e.child(heading(t, "Status bar")))
    .children(status.map((s) => row(t, `status-${s.id}`, s.label, s.on, () => run(s.on ? "layout.hide" : "layout.show", { id: s.id }))))
    .when(panels.length > 0, (e) => e.child(heading(t, "Side panel buttons")))
    .children(panels.map((p) => row(t, `panel-${p.id}`, p.label, p.on, () => setShared(BUTTONS, toggle(buttons, p.id, !p.on)))))
    .child(div().px(8).pt(6).text_size(11).text_color(roles(t, t.popover).hint).child("A hidden block stops its work at the next start."));
}

export default class Controls extends View {
  render() {
    const t = theme();
    if (props()?.view !== "button") return menu(t);
    return h_flex().id("controls").size_full().items_center().justify_center()
      .child(div().id("controls-button").size(22).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(roles(t, t.chrome).hint).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Turn mods on or off")
        .on_click(() => openMenu()).child(svg("mods/controls/controls.svg").size(14)));
  }
}
