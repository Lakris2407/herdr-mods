// The right-panel tab: totals, what waits, each machine with its slots, what finished in the last hour.
// It leads with exceptions: failures and waiting jobs stand out, passed jobs stay quiet and drop off.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { snapshot, refresh } from "./poll.js";
import { configPath } from "./config.js";
import { waiting, finished, summary, medianWait, duration, ago, label, jobKey } from "./model.js";
import { jobRow, loadBar, loadText, button, colors, ink, onFill, freshness, slotColor, openLanes, openJob, runTime } from "./ui.js";

const MIN = 60000, FINISHED = 5;
// A passed job stays in the list this long; failures stay the full hour.
const RECENT = 10 * MIN;
// Cancelled runs are mostly superseded pushes: quiet, like a pass.
const failed = (j) => j.conclusion !== "success" && j.conclusion !== "cancelled";

export class Panel {
  init() {}

  tile(value, hint, t, color) {
    return v_flex().flex_1().min_w(0).px(10).py(8).gap(2).rounded(8).border_1().border_color(t.border)
      .child(div().text_size(20).font_semibold().text_color(color ?? t.foreground).child(value))
      .child(div().truncate().text_size(10).text_color(ink(t).sub).child(hint));
  }

  card(title, hint, body, t, hintColor) {
    return v_flex().gap(6).p(10).rounded(9).border_1().border_color(t.border)
      .child(h_flex().justify_between().items_center()
        .child(div().font_semibold().text_size(12).child(title))
        .child(div().text_size(11).text_color(hintColor ?? ink(t).sub).child(hint)))
      .child(body);
  }

  // The dot claims only what the panel knows: red when a slot is offline, amber ring when ssh fails,
  // green when a slot or ssh answered, a grey ring when nothing has (GitHub hides runners without repo admin).
  dot(m, t) {
    const c = colors(t), off = m.runners.filter((r) => r.status === "offline").length;
    const known = m.load != null || m.runners.some((r) => r.job || r.status === "online");
    const [fill, ring, tip] = off ? [c.off, null, `${off} slot${off > 1 ? "s" : ""} offline`]
      : m.loadError ? [null, c.wait, `ssh failed: ${m.loadError}`]
      : known ? [c.ok, null, "online"]
      : [null, ink(t).track, "no status yet: GitHub lists runners only to repo admins"];
    return div().id(`dot-${m.name}`).size(8).flex_none().rounded(4).tooltip(tip)
      .when(Boolean(fill), (e) => e.bg(fill)).when(Boolean(ring), (e) => e.border_1().border_color(ring));
  }

  // One slot: its name, then a bar with the job it runs (time first; the tooltip names the runner), "free", "no status" or "offline".
  slot(r, j, s, t, now) {
    const c = colors(t), k = ink(t), usual = j && s.typical[jobKey(j)];
    const pct = j?.started && usual ? Math.min(1, (now - j.started) / usual) : null;
    const text = j ? [j.started ? duration(now - j.started) : null, label(j), j.branch].filter(Boolean).join(" · ")
      : r.status === "offline" ? "offline" : r.status === "unknown" ? "no status" : "free";
    const unknown = !j && r.status === "unknown";
    const fg = j ? t.accent_foreground : r.status === "offline" ? onFill(c.off, t) : unknown ? k.sub : k.onIdle;
    return h_flex().id(`slot-${r.name}`).gap(6).items_center().text_size(10)
      .when(Boolean(j), (e) => e.cursor_pointer().on_click(() => openJob(j)).tooltip(`${r.name} · ${label(j)} · ${j.branch} · ${runTime(j, s.typical, now)}`))
      .when(!j, (e) => e.tooltip(unknown ? `${r.name}: no status (GitHub needs repo admin to list it)` : `${r.name} · ${r.status === "online" ? "free" : r.status}`))
      .child(div().w(64).flex_none().truncate().text_color(k.sub).child(r.label ?? r.name))
      .child(div().relative().flex_1().min_w(0).h(17).px(5).flex().items_center().rounded(3).overflow_hidden()
        .when(!unknown, (e) => e.bg(slotColor(r, t)))
        .when(unknown, (e) => e.border_1().border_dashed().border_color(k.track))
        .child(div().truncate().text_color(fg).when(r.status === "offline", (e) => e.font_semibold()).child(text))
        // How far the job is through its usual length; amber past 1.2x, when it runs slow.
        .when(pct != null, (e) => e.child(div().absolute().left_0().bottom_0().h(2)
          .bg(now - j.started > usual * 1.2 ? c.wait : t.accent_foreground).w(`${Math.round(pct * 100)}%`))));
  }

  machine(m, s, t, now) {
    const c = colors(t), k = ink(t);
    const p = m.load != null && m.cores ? m.load / m.cores : 0;
    const jobs = new Map(s.jobs.map((j) => [j.id, j]));
    return v_flex().id(`m-${m.name}`).flex_1().flex_basis(150).min_w(150).gap(6).p(8).rounded(8).border_1()
      .border_color(p >= 0.9 ? c.hot : t.border)
      .child(h_flex().gap(6).items_center().child(this.dot(m, t))
        .child(div().truncate().font_semibold().child(m.name)))
      .when(Boolean(m.ssh), (e) => e.child(h_flex().id(`load-${m.name}`).gap(6).items_center().text_size(10)
        .text_color(m.loadError ? c.wait : p >= 0.9 ? c.hot : k.sub).tooltip(m.loadError ? `ssh ${m.ssh}: ${m.loadError}` : `${loadText(m)} · 1-minute load per core`)
        .child(loadBar(m, t, 56)).child(div().truncate().child(loadText(m)))))
      .when(Boolean(m.warm) && m.warm !== "none", (e) => e.child(div().id(`warm-${m.name}`).truncate().text_size(10).text_color(k.sub)
        .tooltip(`warm: ${m.warm}`).child(`warm: ${m.warm}`)))
      .child(v_flex().gap(3).children(m.runners.map((r) => this.slot(r, r.job ? jobs.get(r.job) : null, s, t, now))));
  }

  finished(s, t, now, tags) {
    const c = colors(t), k = ink(t), f = finished(s, now, 3600000);
    const bad = f.filter(failed), quiet = f.filter((j) => !failed(j));
    const recent = quiet.filter((j) => now - j.completed < RECENT);
    const shown = this.showAll ? [...bad, ...quiet] : [...bad, ...recent.slice(0, Math.max(0, FINISHED - bad.length))];
    const hidden = f.length - shown.length;
    const passed = quiet.filter((j) => j.conclusion === "success").length;
    const hint = !f.length ? "last hour" : bad.length ? `${bad.length} failed · ${passed} passed` : `${passed} passed in the last hour`;
    const mark = (j) => failed(j) ? [`✕ failed ${ago(j.completed, now)}`, c.off] : j.conclusion === "cancelled" ? [`– ${ago(j.completed, now)}`, k.sub] : [`✓ ${ago(j.completed, now)}`, k.sub];
    const sub = (j) => [j.runner ?? "?", `ran ${duration(j.completed - j.started)}`, j.started - j.created > MIN ? `waited ${duration(j.started - j.created)}` : null, j.branch].filter(Boolean).join(" · ");
    return this.card("Finished", hint, v_flex().gap(1)
      .when(!f.length, (e) => e.child(div().px(6).text_size(11).text_color(k.sub).child("No watched jobs finished in the last hour.")))
      .when(f.length > 0 && !shown.length, (e) => e.child(div().px(6).text_size(11).text_color(k.sub)
        .child(`✓ Nothing failed. The last job finished ${ago(f[0].completed, now)}.`)))
      .children(shown.map((j) => {
        const [right, color] = mark(j);
        return jobRow(`f-${j.id}`, j, { right, rightColor: color, sub: sub(j), tag: tags }, t);
      }))
      .when(hidden > 0 || this.showAll, (e) => e.child(div().id("f-more").px(6).pt(4).cursor_pointer().text_size(11).text_color(t.accent)
        .on_click((_e, cx) => { this.showAll = !this.showAll; cx.notify(); })
        .child(this.showAll ? "Show fewer" : `Show ${hidden} older`))), t, bad.length ? c.off : null);
  }

  body(s, t, now) {
    const sum = summary(s, now), w = waiting(s), c = colors(t), mw = medianWait(s, now);
    const bad = finished(s, now, 3600000).filter(failed).length;
    // One repo needs no tag on every row.
    const tags = new Set(s.jobs.map((j) => j.short)).size > 1;
    return v_flex().gap(8)
      .child(h_flex().gap(6)
        .child(this.tile(String(sum.waiting), "waiting", t, sum.waiting ? c.wait : null))
        .child(this.tile(String(bad), "failed · 1h", t, bad ? c.off : null))
        .child(this.tile(`${sum.busy}/${sum.total}`, "slots busy", t))
        .child(this.tile(mw == null ? "—" : duration(mw), "wait today", t)))
      // Waiting jobs are the first thing to act on, so they sit above the machines, and only when there are some.
      .when(w.length > 0, (e) => e.child(this.card("Waiting", `oldest ${duration(sum.longest)}`, v_flex().gap(1).children(
        w.map((j) => jobRow(`w-${j.id}`, j, { right: duration(now - j.created), rightColor: c.wait, sub: `needs ${j.labels.join(", ")} · ${j.branch}`, tag: tags }, t))), t)))
      .child(h_flex().flex_wrap().items_start().gap(6).children(s.machines.map((m) => this.machine(m, s, t, now))))
      .child(this.finished(s, t, now, tags));
  }

  // A failed read names when, what, and that the panel shows the last good data.
  error(s, t, now) {
    const c = colors(t), k = ink(t);
    return v_flex().gap(2).px(2).text_size(11)
      .child(div().font_semibold().text_color(c.off).child(s.errorAt ? `Last read failed ${ago(s.errorAt, now)}` : "Part of the last read failed"))
      .child(div().text_color(k.sub).child(s.error))
      .child(div().text_color(k.sub).child(s.at ? "Showing the last good data. Refresh tries again." : "Refresh tries again."));
  }

  render() {
    const t = theme(), s = snapshot(), now = Date.now(), fresh = freshness(s, now);
    return v_flex().id("runners").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(h_flex().h(42).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Runners"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(fresh.stale ? colors(t).wait : ink(t).sub).child(fresh.text))
        .child(button("runners-lanes", "Timeline", t, () => openLanes()))
        .child(button("runners-refresh", "Refresh", t, () => refresh())))
      .child(v_flex().id("runners-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
        .when(Boolean(s?.error), (e) => e.child(this.error(s, t, now)))
        .when(!s, (e) => e.child(div().p(4).text_color(ink(t).sub).child("Reading the runners…")))
        .when(Boolean(s?.missing), (e) => e.child(this.card("Set up", "", v_flex().gap(4).text_size(11).text_color(t.muted)
          .child(`Create ${configPath()} with your repos and machines.`)
          .child("See the README for every field, or try it with { \"demo\": true }."), t)))
        .when(Boolean(s?.at), (e) => e.child(this.body(s, t, now))));
  }
}
