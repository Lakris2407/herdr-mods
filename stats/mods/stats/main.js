// Your own delivery numbers across every repo in a side panel: PRs merged, time to merge, AI share, reviews and commits.
// Data comes from `gh` (load.js) and is kept in shared state for 30 minutes, so opening the panel is instant.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared, setShared, nextCommand } from "herdr";
import { loadRaw } from "./load.js";
import { buildStats, duration, delta, num, compact } from "./stats.js";
import { readable } from "./colors.js";

const CACHE = "stats.v2", STALE = 30 * 60000, CHECK = 5 * 60000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Checked for dark-theme lightness and color-blind separation in this order (Claude, Codex). A PR with
// both marks is drawn as both colors, half and half, so "Both" needs no third hue.
const CLAUDE = "#d4704f", CODEX = "#3f86e0";
const TOP_REPOS = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Within this many percent of your usual week counts as on pace: PR counts are noisy day to day.
const ON_PACE = 10;

const short = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "just now";
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

// The theme's own colors, lifted only where a theme sets them below a readable contrast on the cards:
// labels at 6:1, hints at 4.5:1 (all of this text is 10–11px), and the good/bad colors at 4.5:1.
function inks(t) {
  return {
    label: readable(t.muted, t.raised, 6),
    hint: readable(t.dim, t.raised, 4.5),
    good: readable(t.ansi2, t.raised, 4.5),
    bad: readable(t.ansi1, t.raised, 4.5),
    header: readable(t.dim, t.background, 4.5),
  };
}

// One comparison format everywhere: the glyph and amount in the verdict color, the baseline in the hint color.
// `better` says which direction is good: more PRs, but less time to merge.
function versus(change, baseline, better = "more") {
  if (!change) return null;
  const good = better === "more" ? change.d > 0 : change.d < 0;
  return { tone: change.d === 0 ? "flat" : good ? "good" : "bad", glyph: change.d > 0 ? "▲" : change.d < 0 ? "▼" : "•",
    amount: change.text, rest: change.d === 0 ? `as ${baseline}` : `vs ${baseline}` };
}

// This week against your usual week at the same point, in quota's words: on pace, ahead of pace, under pace.
function paceLine(p) {
  if (!p) return null;
  if (p.diff == null) return p.usualWeek ? { tone: "flat", glyph: "•", amount: "", rest: `usual week ${num(p.usualWeek)}` } : null;
  if (Math.abs(p.diff) < ON_PACE) return { tone: "flat", glyph: "•", amount: "on pace", rest: "" };
  return { tone: p.diff > 0 ? "good" : "bad", glyph: p.diff > 0 ? "▲" : "▼", amount: `${Math.abs(p.diff)}%`,
    rest: p.diff > 0 ? "ahead of pace" : "under pace" };
}

export default class Stats extends View {
  init(_props, cx) {
    this.cache = shared(CACHE) ?? null;
    if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx);
    cx.timer.every(CHECK, (cx) => { if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "refresh") this.load(cx);
        cx.notify();
      }
    });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const raw = await loadRaw();
        this.cache = { at: Date.now(), stats: buildStats(raw) };
        setShared(CACHE, this.cache);
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  // A comparison line: glyph and amount in the verdict color, the rest quieter.
  verdict(line, ink) {
    const color = { good: ink.good, bad: ink.bad, flat: ink.label }[line.tone];
    return h_flex().min_w(0).gap(4)
      .child(div().flex_none().text_color(color).child(`${line.glyph} ${line.amount}`.trim()))
      .when(Boolean(line.rest), (e) => e.child(div().min_w(0).truncate().text_color(ink.hint).child(line.rest)));
  }

  // Every tile has the same four slots (label, value, comparison, context), so the rows line up across tiles.
  tile(id, { label, value, line, context, tip }, t, ink) {
    return v_flex().id(id).flex_1().min_w(0).gap(1).px(10).py(9).rounded(8).bg(t.raised)
      .when(Boolean(tip), (e) => e.tooltip(tip))
      .child(div().text_size(11).text_color(ink.label).child(label))
      .child(div().text_size(22).font_semibold().child(value))
      .child(h_flex().h(15).min_w(0).text_size(11).when(Boolean(line), (e) => e.child(this.verdict(line, ink))))
      .child(div().h(15).min_w(0).truncate().text_size(11).text_color(ink.hint).child(context ?? ""));
  }

  // One series, so no legend: the card title names it. Every bar carries its value; the highlighted bar is
  // brighter. `ghost` draws a dashed outline above the highlighted bar up to where it is heading.
  bars(id, items, { height, label, tip, highlight, faded, ghost }, t, ink) {
    const max = Math.max(1, ghost ?? 0, ...items.map((i) => i.value));
    const plot = height - 16, h = (v) => Math.round(plot * v / max);
    return v_flex().gap(4)
      .child(h_flex().h(height).items_end().gap(3).children(items.map((item, n) => {
        const now = n === highlight, solid = Math.max(item.value > 0 ? 3 : 2, h(item.value));
        const bar = item.future ? div().w_full().h(1).bg(t.border)
          : div().w_full().h(solid).rounded_t(item.value > 0 ? 4 : 0)
            .bg(item.value > 0 ? t.accent : ink.hint).opacity(now || !faded ? 1 : 0.75);
        const column = now && ghost > item.value
          ? v_flex().w_full().h(h(ghost)).justify_end().rounded_t(4).border_1().border_dashed().border_color(t.accent).child(bar)
          : bar;
        return v_flex().id(`${id}-${n}`).flex_1().min_w(0).h_full().justify_end().items_center().gap(2).tooltip(tip(item))
          .child(div().h(12).text_size(10).text_color(now ? t.foreground : ink.hint).child(item.future ? "" : compact(item.value)))
          .child(column);
      })))
      .child(h_flex().gap(3).children(items.map((item, n) => div().flex_1().min_w(0).whitespace_nowrap().text_size(10).text_center()
        .text_color(n === highlight ? t.foreground : ink.hint).when(n === highlight, (e) => e.font_semibold()).child(label(item, n)))));
  }

  card(title, sub, body, t, ink, aside = null) {
    return v_flex().gap(6).px(10).pt(10).pb(8).rounded(8).bg(t.raised)
      .child(h_flex().gap(8).items_start()
        .child(v_flex().flex_1().min_w(0)
          .child(div().text_size(13).font_semibold().child(title))
          .child(div().min_w(0).truncate().text_size(11).text_color(ink.hint).child(sub)))
        .when(aside != null, (e) => e.child(div().flex_none().text_size(13).font_semibold().child(aside))))
      .child(body);
  }

  // One magnitude per repo: a single hue, longest first, the number beside each bar. The owner shows only
  // when two listed repos share a name.
  repoList(repos, t, ink) {
    const max = Math.max(1, ...repos.map((r) => r.merged)), top = repos.slice(0, TOP_REPOS), rest = repos.slice(TOP_REPOS);
    const restPrs = rest.reduce((n, r) => n + r.merged, 0);
    const names = top.map((r) => r.repo.split("/")[1]);
    const name = (r, i) => (names.filter((x) => x === names[i]).length > 1 ? r.repo : names[i]);
    return v_flex().gap(6)
      .children(top.map((r, i) => v_flex().id(`repo-${r.repo}`).gap(3).tooltip(`${r.repo}: ${plural(r.merged, "PR")} merged, ${plural(r.commits, "commit")}`)
        .child(h_flex().gap(8).text_size(12)
          .child(div().flex_1().min_w(0).truncate().text_color(ink.label).child(name(r, i)))
          .child(div().flex_none().font_semibold().child(num(r.merged))))
        .child(div().h(6).w_full().rounded(3).bg(t.border)
          .child(div().h(6).rounded(3).bg(t.accent).w(`${Math.max(2, Math.round(100 * r.merged / max))}%`)))))
      .when(rest.length > 0, (e) => e.child(div().text_size(11).text_color(ink.hint)
        .child(`${plural(rest.length, "more repo")} · ${plural(restPrs, "PR")}`)));
  }

  // A share of a whole: one split bar with 2px gaps, then a legend with counts, so color is never the only label.
  aiSplit(ai, t, ink) {
    const swatch = (p, h) => (p.key === "both"
      ? v_flex().h(h).rounded(2).overflow_hidden().child(div().flex_1().bg(CLAUDE)).child(div().flex_1().bg(CODEX))
      : div().h(h).rounded(2).bg(p.color));
    const parts = [
      { key: "claude", label: "Claude", color: CLAUDE, n: ai.claude },
      { key: "codex", label: "Codex", color: CODEX, n: ai.codex },
      { key: "both", label: "Both", n: ai.both },
      { key: "none", label: "No AI mark", color: ink.hint, n: ai.none },
    ].filter((p) => p.n > 0);
    if (!parts.length) return div().text_size(11).text_color(ink.hint).child("No merged PRs in the last 30 days.");
    return v_flex().gap(8)
      .child(h_flex().h(8).gap(2).children(parts.map((p) => swatch(p, 8).id(`ai-${p.key}`)
        .flex_grow(p.n).flex_basis(0).min_w(3).tooltip(`${p.label}: ${plural(p.n, "PR")}`))))
      .child(h_flex().flex_wrap().gap(12).text_size(11).text_color(ink.label).children(parts.map((p) =>
        h_flex().gap(5).items_center().child(swatch(p, 8).w(8)).child(`${p.label} ${num(p.n)}`))));
  }

  row(label, value, hint, t, ink) {
    return h_flex().gap(8).py(6).items_center().border_t(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(ink.label).child(label))
      .child(typeof hint === "string" ? div().min_w(0).flex_shrink(1).truncate().text_size(11).text_color(ink.hint).child(hint)
        : div().min_w(0).flex_shrink(1).text_size(11).child(hint))
      .child(div().flex_none().min_w(56).text_right().font_semibold().child(value));
  }

  body(s, t, ink) {
    const weeks = s.weeks, last = weeks.length - 1, today = (new Date().getDay() + 6) % 7, p = s.pace;
    const made = s.ai.claude + s.ai.codex + s.ai.both, pct = s.ai.total ? Math.floor(100 * made / s.ai.total) : null; // floor: 845 of 848 is not 100%
    const commitsWeek = s.commitsThisWeek == null ? null : plural(s.commitsThisWeek, "commit");
    const oldest = s.oldestOpen;
    return v_flex().gap(8)
      .child(h_flex().gap(6).items_stretch()
        .child(this.tile("tile-week", {
          label: "Merged this week", value: num(s.mergedThisWeek), line: paceLine(p),
          context: [p?.projected != null && p.projected > s.mergedThisWeek ? `~${num(p.projected)} by Sun` : null, commitsWeek].filter(Boolean).join(" · "),
          tip: p ? `Usual week: ${plural(p.usualWeek ?? 0, "PR")} (median of the last 4). By now in a usual week: ${num(p.usualSoFar ?? 0)}. Last week: ${num(s.mergedLastWeek)}.` : null,
        }, t, ink))
        .child(this.tile("tile-30", {
          label: "Merged · 30 days", value: num(s.merged30), line: versus(delta(s.merged30, s.mergedPrev30), "prior 30"),
          context: `${num(Math.round(s.merged30 / 30))} a day`,
        }, t, ink)))
      .child(h_flex().gap(6).items_stretch()
        .child(this.tile("tile-ttm", {
          label: "Time to merge", value: duration(s.medianHours),
          line: versus(delta(s.medianHours, s.prevMedianHours, (h) => duration(h)), "prior 30", "less"),
          context: "median · 30 days",
        }, t, ink))
        .child(this.tile("tile-open", {
          label: "Open PRs", value: num(s.open),
          line: s.oldestOpenDays == null ? { tone: "flat", glyph: "", amount: "none open", rest: "" } : { tone: "flat", glyph: "", amount: `oldest ${s.oldestOpenDays}d`, rest: "" },
          context: oldest ? `${oldest.repo.split("/")[1]}#${oldest.number}` : "",
          tip: oldest ? `Oldest open PR: ${oldest.repo}#${oldest.number}, opened ${plural(s.oldestOpenDays, "day")} ago` : null,
        }, t, ink)))
      .child(this.card("PRs merged per week", "all your repos · releases to main not counted",
        this.bars("wk", weeks.map((w) => ({ ...w, value: w.merged })), {
          height: 110, highlight: last, faded: true, ghost: p?.projected ?? null,
          label: (w, n) => (n === last ? "now" : n % 3 === 0 ? short(w.start) : ""),
          tip: (w) => (w === weeks[last] && p?.projected != null
            ? `This week so far: ${plural(w.merged, "PR")}, heading for about ${num(p.projected)}`
            : `Week of ${short(w.start)}: ${plural(w.merged, "PR")} merged`),
        }, t, ink), t, ink))
      .child(this.card("This week, day by day", "PRs merged · your local time",
        this.bars("day", s.days.map((d) => ({ ...d, value: d.merged })), {
          height: 70, highlight: today, faded: false,
          label: (_d, n) => DAYS[n],
          tip: (d) => `${DAYS[(new Date(d.start).getDay() + 6) % 7]} ${short(d.start)}: ${d.future ? "not yet" : `${num(d.merged)} merged`}`,
        }, t, ink), t, ink))
      .child(this.card("AI share", s.ai.total ? `${num(made)} of ${plural(s.ai.total, "merged PR")} made with AI · 30 days` : "merged PRs · last 30 days",
        this.aiSplit(s.ai, t, ink), t, ink, pct == null ? "—" : `${pct}%`))
      .child(this.card("By repo", "PRs merged · last 30 days", this.repoList(s.repos, t, ink), t, ink))
      .child(this.card("Commits, reviews, merge rate", "all your repos", v_flex()
        .child(this.row("Your commits", num(s.commits30), `${plural(s.repos.filter((r) => r.commits > 0).length, "repo")} · 30 days`, t, ink))
        .child(this.row("Reviews of others' PRs", num(s.reviews.last30),
          (() => { const v = versus(delta(s.reviews.last30, s.reviews.prev30), "prior 30"); return v ? this.verdict(v, ink) : "30 days"; })(), t, ink))
        .child(this.row("Merge rate", s.mergeRate == null ? "—" : `${s.mergeRate}%`, `${num(s.decided)} closed or merged · 90 days`, t, ink)), t, ink));
  }

  render(cx) {
    const t = theme(), ink = inks(t), s = this.cache?.stats;
    const stale = Boolean(this.cache) && Date.now() - this.cache.at > STALE;
    const status = this.loading ? "Loading…" : this.cache ? `updated ${ago(this.cache.at)}` : "";
    return v_flex().id("stats").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Your stats"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(ink.header).child(status))
        .child(div().id("stats-refresh").px(8).h(24).flex().items_center().rounded(6).cursor_pointer().text_size(11)
          .text_color(readable(t.muted, t.background, 6)).border_1().border_color(t.border)
          .hover((e) => e.bg(t.hover)).on_click((_e, cx) => this.load(cx)).child(this.loading ? "Loading…" : "Refresh")))
      .child(v_flex().id("stats-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
        .when(Boolean(this.error), (e) => e.child(div().text_size(11).text_color(readable(t.ansi1, t.background, 4.5)).child(this.error)))
        .when(!s && !this.error, (e) => e.child(div().p(4).text_color(ink.header).child("Loading your numbers… the first load takes about 15 seconds.")))
        .when(Boolean(s), (e) => e.child(this.body(s, t, ink).when(stale && !this.loading, (b) => b.opacity(0.6)))));
  }
}
