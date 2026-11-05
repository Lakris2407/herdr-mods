// Pieces every view shares: repo tag, job row, slot squares, load bar.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, openOverlay } from "herdr";
import { label, duration, pressure, jobKey, ago } from "./model.js";
import { snapshot } from "./poll.js";
import { readable, contrast, flatten } from "./colors.js";

export const colors = (t = theme()) => ({ run: t.accent, wait: t.ansi3, off: t.ansi1, ok: t.ansi2, hot: t.ansi11 ?? t.ansi3, idle: t.border });

// Secondary text that stays readable: themes set `dim` for taste, often below 4.5:1.
// `sub` reads on the view's background, `onIdle` on a free slot's fill, `track` is a bar's empty part.
export const ink = (t = theme(), bg = t.background) => ({
  sub: readable(t.muted, bg, 4.5),
  onIdle: readable(t.muted, flatten(t.border, bg), 4.5),
  track: readable(flatten(t.dim, bg), bg, 3),
});

// Text on a colored fill: whichever of the theme's two poles reads better on it.
export const onFill = (fill, t) => {
  const f = flatten(fill, t.background);
  return (contrast(t.background, f) ?? 0) >= (contrast(t.foreground, f) ?? 0) ? t.background : t.foreground;
};

// How old the data is. A failed read keeps the time of the last good data, so the header never says "just now" over old jobs.
export function freshness(s, now) {
  if (!s) return { text: "Loading…", stale: false };
  if (s.errorAt) return { text: s.at ? `data from ${ago(s.at, now)} · last read failed` : "could not read the runners", stale: true };
  return { text: `updated ${ago(s.at, now)}`, stale: false };
}

// The timeline is a window you open, never part of the layout.
export function openLanes() {
  const lanes = snapshot()?.machines.reduce((n, m) => n + m.runners.length, 0) ?? 5;
  openOverlay({ mod: "runners", kind: "window", key: "runners-lanes", width: 940, height: Math.min(720, 150 + lanes * 32), props: { view: "lanes" } });
}

// Links come from GitHub's API; only https reaches the system's opener.
export function openUrl(url) {
  try {
    if (new URL(url).protocol === "https:") exec("open", ["--", url]).catch(() => {});
  } catch {}
}

// A GitHub job opens on GitHub; a lanes job opens its log folder on this Mac.
export function openJob(j) {
  if (j.url) openUrl(j.url);
  else if (j.logs?.startsWith("/")) exec("open", ["--", j.logs]).catch(() => {});
}

export function repoTag(j, t) {
  return div().w(34).flex_none().py(1).rounded(4).bg(t.border).text_center().text_size(10).font_semibold()
    .text_color(t[j.color] ?? t.foreground).child(j.short);
}

export function slotColor(r, t) {
  const c = colors(t);
  return r.job ? c.run : r.status === "offline" ? c.off : c.idle;
}

// The status bar squares: one per slot.
export function squares(list, t) {
  return h_flex().gap(2).items_center().children(list.map((r) =>
    div().id(`sq-${r.name}`).w(6).h(12).rounded(2).bg(slotColor(r, t))
      .when(r.status === "unknown" && !r.job, (e) => e.bg(t.surface).border_1().border_color(t.border))
      .tooltip(`${r.name} · ${r.job ? "running" : r.status === "online" ? "idle" : r.status}`)));
}

export function loadBar(m, t, width = 60) {
  const p = pressure(m), c = colors(t);
  const color = p == null ? t.border : p >= 1.5 ? c.off : p >= 0.9 ? c.hot : p >= 0.6 ? c.wait : c.ok;
  return div().w(width).h(5).rounded(3).bg(ink(t).track).overflow_hidden()
    .child(div().h_full().rounded(3).bg(color).w(Math.round(width * Math.min(1, p ?? 0))));
}

export function loadText(m) {
  if (!m.ssh) return "no ssh";
  if (m.loadError) return m.loadError;
  if (m.load == null) return "…";
  return `load ${m.load.toFixed(1)} / ${m.cores ?? "?"}`;
}

// One job: repo tag, what and where, and a time on the right. `bar` adds progress against the usual length.
// `tag: false` drops the repo tag, for a setup that watches one repo.
export function jobRow(id, j, { right, rightColor, sub, typical, now, tag = true }, t) {
  const usual = typical?.[jobKey(j)];
  const pct = j.started && usual ? Math.min(1, (now - j.started) / usual) : null;
  // Past 1.2x its usual length, the bar turns amber: this run is slow, not almost done.
  const slow = j.started && usual && now - j.started > usual * 1.2;
  return h_flex().id(id).gap(8).px(6).py(5).items_center().rounded(6).cursor_pointer()
    .hover((e) => e.bg(t.hover)).on_click(() => openJob(j)).tooltip(j.url ? `${j.repo} · open on GitHub` : `${j.repo} · ${j.worktree} · open its logs`)
    .when(tag, (e) => e.child(repoTag(j, t)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_color(t.foreground).child(label(j)))
      .child(div().truncate().text_size(11).text_color(ink(t).sub).child(sub))
      .when(pct != null, (e) => e.child(div().h(3).w_full().rounded(2).bg(ink(t).track).overflow_hidden()
        .child(div().h_full().bg(slow ? t.ansi3 : t.accent).w(`${Math.round(pct * 100)}%`)))))
    .child(div().flex_none().text_size(11).text_color(rightColor ?? t.muted).child(right));
}

export const runTime = (j, typical, now) => {
  const usual = typical?.[jobKey(j)];
  return usual ? `${duration(now - j.started)} / ~${duration(usual)}` : duration(now - j.started);
};

export function button(id, text, t, onClick) {
  return div().id(id).px(8).h(24).flex().items_center().rounded(6).cursor_pointer().text_size(11).text_color(t.muted)
    .border_1().border_color(t.border).hover((e) => e.bg(t.hover)).on_click(onClick).child(text);
}

export function groupTitle(left, right, t) {
  return h_flex().justify_between().px(6).text_size(10).font_semibold().text_color(ink(t, t.popover).sub)
    .child(left.toUpperCase()).child(right ?? "");
}
