import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme as herdrTheme, run, window, keys, settings, shared } from "herdr";
import { roles } from "./colors.js";
import { branchLabel } from "./names.js";

// herdr-mods: quiet text lifted to 4.5:1 on the status bar (colors.js).
function theme() {
  const t = herdrTheme(), r = roles(t, t.chrome);
  return { ...t, dim: r.hint, muted: r.sub };
}

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    // herdr-mods: what you came for first, in a fixed order of what stays when the bar is narrow:
    // the branch (shortened, never dropped), the agents and who needs you, then the machine, then the
    // palette hint. Sizes arrive in screen pixels; the layout works in zoomed units.
    const w = this.width ?? Infinity, machine = w >= 330, hint = w >= 440;
    const label = (icon, text) => h_flex().min_w(0).gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none())
      .child(div().min_w(0).truncate().child(text));
    return h_flex().id("workspace-status").size_full().overflow_hidden().px(12).gap(10).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .on_size_change((size, cx) => { const v = size.width / (settings().zoom || 1); if (v !== this.width) { this.width = v; cx.notify(); } })
      .tooltip(`${space?.machine ?? "This computer"}${space?.branch ? ` · ${space.branch}` : ""}`)
      // herdr-mods: "cw/Acme-<stamp>" reads "worktree 19:44" (names.js); the tooltip has it all.
      .when(Boolean(space?.branch), el => el.child(label("branch", branchLabel(space.branch, shared("space.labels")?.[space.id]?.name))))
      .child(h_flex().flex_none().gap(6).items_center().child(div().size(6).rounded(3).bg(needs ? t.blocked : t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(machine, el => el.child(div().flex_none().child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))))
      .child(div().flex_1())
      .when(hint, el => el.child(div().id("palette").flex_none().text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t))));
  }
}
