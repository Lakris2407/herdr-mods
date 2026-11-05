// Your own delivery numbers across every repo in a side panel: this week first, then what waits on you,
// the 12-week trend, the last 30 days and where the work went.
// Data comes from `gh` (load.js) and is kept in shared state for 30 minutes, so opening the panel is instant.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, run, shared, setShared, nextCommand, layout, props as blockProps } from "herdr";
import { loadRaw } from "./load.js";
import { demoRaw } from "./demo.js";
import { buildStats, duration, change, plainError, TIME_WORDS, STALE_PR_DAYS, num, compact } from "./stats.js";
import { readable, isLight } from "./colors.js";

// A minute's tick keeps "updated 5m ago" true and reloads once the numbers are 30 minutes old.
const CACHE = "stats.v4", STALE = 30 * 60000, TICK = 60000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Claude and Codex differ in lightness as well as hue, so the split still reads without color vision:
// a dark orange and, on a dark card, a light blue (a dark blue on a light card).
const CLAUDE = "#d4704f", CODEX_ON_DARK = "#a8cdf8", CODEX_ON_LIGHT = "#1d4f99";
const TOP_REPOS = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Within this many percent counts as no change: PR counts and merge times are noisy, so a small
// difference gets no green or red (the pace line uses the same band).
const NOISE = 10;
const GH = "https://github.com";
const search = (q) => `${GH}/pulls?q=${encodeURIComponent(`is:open is:pr ${q}`)}`;

const short = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
const prName = (r) => `${r.repo.split("/")[1]}#${r.number}`;
const prUrl = (r) => `${GH}/${r.repo}/pull/${r.number}`;

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "just now";
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

// GitHub pages open in the system browser; only https reaches the opener.
function openUrl(url) {
  if (url.startsWith(`${GH}/`)) exec("open", ["--", url]).catch(() => {});
}

// Which way Escape leaves the panel: toward the terminals, wherever the layout puts the panel.
function leaveSide() {
  let path = null;
  const find = (n, up) => {
    if (path || !n) return;
    if (n.content?.mod === "stats") path = [...up, n];
    else for (const c of n.children ?? []) find(c, [...up, n]);
  };
  find(layout(), []);
  const terminals = (n) => n?.content?.tab != null || (n?.children ?? []).some(terminals);
  for (let i = (path?.length ?? 0) - 2; i >= 0; i--) {
    const kids = path[i].type === "row" ? path[i].children : null;
    if (!kids) continue;
    const at = kids.indexOf(path[i + 1]);
    if (kids.slice(0, at).some(terminals)) return "left";
    if (kids.slice(at + 1).some(terminals)) return "right";
  }
  return "left";
}

// The theme's own colors, lifted only where a theme sets them below a readable contrast on the cards:
// labels at 6:1, hints and verdict colors at 4.5:1 (all of this text is 10–12px), and marks (bars,
// the AI split, the focus ring) at 3:1, the floor for non-text UI.
function inks(t) {
  return {
    label: readable(t.muted, t.raised, 6),
    hint: readable(t.dim, t.raised, 4.5),
    good: readable(t.ansi2, t.raised, 4.5),
    bad: readable(t.ansi1, t.raised, 4.5),
    header: readable(t.dim, t.background, 4.5),
    headerWarn: readable(t.ansi3, t.background, 4.5),
    button: readable(t.muted, t.raised, 6),
    bar: readable(t.accent, t.raised, 3),
    ghost: readable(t.accent, t.raised, 5),
    ring: readable(t.accent, t.raised, 3),
    claude: readable(CLAUDE, t.raised, 3),
    codex: readable(isLight(t.raised) ? CODEX_ON_LIGHT : CODEX_ON_DARK, t.raised, 3),
  };
}

// A comparison in words, with the change as a percentage. Color only backs the words up: `judge` says
// which direction is good; without one (reviews, where fewer is not worse), or inside the noise band,
// the line stays neutral.
function versus(c, baseline, judge = null) {
  if (!c) return null;
  const small = c.d === 0 || (c.pct != null && Math.abs(c.pct) < NOISE);
  const tone = !judge || small ? "flat" : (judge === "more" ? c.d > 0 : c.d < 0) ? "good" : "bad";
  const pct = c.d !== 0 && c.pct != null ? ` (${c.pct > 0 ? "+" : "−"}${Math.abs(c.pct)}%)` : "";
  return { tone, amount: c.text + pct, rest: `${c.d === 0 ? "as" : "than"} ${baseline}` };
}

// This week against your usual week at the same point, as a plain fact: no red for a lighter week.
function paceLines(p, merged) {
  if (!p) return [null, null];
  const usual = p.usualWeek ? `usual week ${num(p.usualWeek)}` : null;
  const heading = p.projected != null && p.projected > merged ? `heading for ~${num(p.projected)} by Sunday` : null;
  const lead = p.diff == null ? null
    : Math.abs(p.diff) < NOISE ? "On your usual pace"
      : `${Math.abs(p.diff)}% ${p.diff > 0 ? "ahead of" : "behind"} your usual pace`;
  const rest = [heading, usual].filter(Boolean).join(" · ");
  return [lead, rest ? rest[0].toUpperCase() + rest.slice(1) : null];
}

// What each "waiting on you" bucket says and where it opens when it holds more than one PR.
const WAITING = {
  review: { label: "Asked for your review", url: `${GH}/pulls/review-requested` },
  failing: { label: "Checks failing", url: search("author:@me status:failure"), tone: "bad" },
  changes: { label: "Changes requested", url: search("author:@me review:changes-requested") },
  ready: { label: "Ready to merge", url: search("author:@me status:success draft:false -review:changes-requested -review:required"), tone: "good" },
};

export default class Stats extends View {
  init(props, cx) {
    // `{ "demo": true }` in the block's props: made-up numbers for screenshots, no `gh`, no shared state.
    this.demo = Boolean((props ?? blockProps())?.demo);
    this.cache = this.demo ? { at: Date.now(), stats: buildStats(demoRaw()) } : shared(CACHE) ?? null;
    this.handle = cx.focus_handle();
    this.at = 0; // the keyboard cursor over this.actions
    this.allRepos = false;
    if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx);
    cx.timer.every(TICK, (cx) => {
      if (!this.cache || Date.now() - this.cache.at > STALE) this.load(cx);
      else cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") this.load(cx);
        else if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  load(cx) {
    if (this.demo) { this.cache = { at: Date.now(), stats: buildStats(demoRaw()) }; cx.notify(); return; }
    if (this.loading) return;
    this.loading = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const raw = await loadRaw();
        this.cache = { at: Date.now(), stats: buildStats(raw) };
        setShared(CACHE, this.cache);
      } catch (e) { this.error = plainError(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  // Everything you can act on registers here while the panel renders, in reading order, so the
  // keyboard walks the same list the mouse sees: up and down move, Enter opens, R refreshes. Each one
  // names itself for a screen reader, and the one under the cursor says it is the current one.
  // `edge` is the 2px border's color when the cursor is elsewhere: the surface it sits on.
  action(el, id, act, t, { label, role = "link", edge = t.raised } = {}) {
    const n = this.actions.push(act) - 1, cursor = n === this.at && this.handle.is_focused();
    return el.id(id).role(role).when(Boolean(label), (e) => e.accessibility_label(label))
      .cursor_pointer().border_2().border_color(cursor ? this.ink.ring : edge).when(cursor, (e) => e.aria_active_descendant())
      .hover((e) => e.bg(t.hover)).on_click((_e, cx) => { this.at = n; act(cx); cx.notify(); });
  }

  key(e, cx) {
    const n = this.actions.length;
    if (e.keystroke === "down" && n) this.at = (this.at + 1) % n;
    else if (e.keystroke === "up" && n) this.at = (this.at + n - 1) % n;
    else if ((e.keystroke === "enter" || e.keystroke === "space") && n) this.actions[this.at]?.(cx);
    else if (e.keystroke === "r") this.load(cx);
    else if (e.keystroke === "escape") run("pane.go", { direction: leaveSide() });
    else if (e.keystroke === "left" || e.keystroke === "right") run("pane.go", { direction: e.keystroke });
    else return;
    cx.notify();
  }

  // A comparison line: the amount in words, in the verdict color; the baseline quieter.
  verdict(line, ink) {
    const color = { good: ink.good, bad: ink.bad, flat: ink.label }[line.tone];
    return h_flex().min_w(0).gap(4).text_size(11)
      .child(div().flex_none().text_color(color).child(line.amount))
      .child(div().min_w(0).truncate().text_color(ink.hint).child(line.rest));
  }

  // Every bar carries its value. `now` is the current bar: its value and axis label are in the text
  // color and its label says so ("Today", "now"). `ghost` draws a dashed outline above it up to where
  // the week is heading, and the label then names that estimate. Future days draw nothing, so they
  // never read as a day with no merges. A screen reader gets the whole chart as one sentence.
  bars(id, items, { height, label, tip, now, ghost, summary }, t, ink) {
    const max = Math.max(1, ghost ?? 0, ...items.map((i) => i.value));
    const plot = height - 16, h = (v) => Math.round(plot * v / max);
    return v_flex().id(id).role("image").accessibility_label(summary).gap(4)
      .child(h_flex().h(height).items_end().gap(3).children(items.map((item, n) => {
        const lit = n === now, ghosted = lit && ghost > item.value;
        const bar = item.future ? div()
          : div().w_full().h(Math.max(item.value > 0 ? 3 : 2, h(item.value))).rounded_t(item.value > 0 ? 4 : 0)
            .bg(item.value > 0 ? ink.bar : ink.hint);
        const column = ghosted
          ? v_flex().w_full().h(h(ghost)).justify_end().rounded_t(4).border_1().border_dashed().border_color(ink.ghost).child(bar)
          : bar;
        const value = item.future ? "" : ghosted ? `~${compact(ghost)}` : compact(item.value);
        return v_flex().id(`${id}-${n}`).flex_1().min_w(0).h_full().justify_end().items_center().gap(2).tooltip(tip(item))
          .child(div().h(12).whitespace_nowrap().text_size(10).text_color(lit ? t.foreground : ink.hint).child(value))
          .child(column);
      })))
      // Axis labels may run wider than their column: only every third week has one, so they spill into blanks.
      .child(h_flex().gap(3).children(items.map((item, n) => div().flex_1().min_w(0).whitespace_nowrap().text_size(10).text_center()
        .text_color(n === now ? t.foreground : ink.hint).when(n === now, (e) => e.font_semibold()).child(label(item, n)))));
  }

  card(title, sub, body, t, ink, aside = null) {
    return v_flex().gap(8).px(10).pt(10).pb(10).rounded(8).bg(t.raised)
      .child(h_flex().gap(8).items_start()
        .child(v_flex().flex_1().min_w(0)
          .child(div().min_w(0).truncate().text_size(13).font_semibold().child(title))
          .when(Boolean(sub), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(ink.hint).child(sub))))
        .when(aside != null, (e) => e.child(typeof aside === "string" ? div().flex_none().text_size(13).font_semibold().child(aside) : aside)))
      .when(body != null, (e) => e.child(body));
  }

  // The answer to "how is this week going": the count, the pace in words, then the days.
  hero(s, t, ink) {
    const p = s.pace, today = (new Date().getDay() + 6) % 7;
    const [lead, rest] = paceLines(p, s.mergedThisWeek);
    const detail = p ? `Usual week: ${plural(p.usualWeek ?? 0, "PR")}, the median of the last 4. By this point of a usual week: ${num(p.usualSoFar ?? 0)}. Last week: ${num(s.mergedLastWeek)}.` : null;
    const merged = `${num(s.mergedThisWeek)} ${s.mergedThisWeek === 1 ? "PR" : "PRs"} merged this week`;
    const days = s.days.filter((d) => !d.future).map((d, n) => `${n === today ? "today" : DAYS[n]} ${d.merged}`).join(", ");
    return v_flex().gap(10).px(10).pt(10).pb(10).rounded(8).bg(t.raised)
      .child(div().text_size(13).font_semibold().child("This week"))
      .child(v_flex().id("pace").gap(2).when(Boolean(detail), (e) => e.tooltip(detail))
        .accessibility_label([merged, lead, rest, detail].filter(Boolean).join(". "))
        .child(h_flex().gap(6).items_end()
          .child(div().text_size(30).line_height(1.05).font_semibold().child(num(s.mergedThisWeek)))
          .child(div().pb(3).text_size(12).text_color(ink.label).child(s.mergedThisWeek === 1 ? "PR merged" : "PRs merged")))
        .when(Boolean(lead), (e) => e.child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(lead)))
        .when(Boolean(rest), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(ink.hint).child(rest))))
      .child(this.bars("day", s.days.map((d) => ({ ...d, value: d.merged })), {
        height: 58, now: today, label: (_d, n) => (n === today ? "Today" : DAYS[n]),
        summary: `PRs merged each day this week: ${days}.`,
        tip: (d) => `${DAYS[(new Date(d.start).getDay() + 6) % 7]} ${short(d.start)}: ${d.future ? "not yet" : `${plural(d.merged, "PR")} merged`}`,
      }, t, ink));
  }

  // The second answer, "what needs me now": reviews you were asked for, then your own PRs by what
  // they wait on, then the stale ones. A row of one PR opens it; a row of more opens the list on GitHub.
  waiting(s, t, ink) {
    const rows = s.waiting.filter((b) => b.count > 0);
    const all = this.action(h_flex().mx(-6).px(4).py(1).rounded(6).text_size(12).text_color(ink.label), "open-all",
      () => openUrl(search("author:@me archived:false")), t, { label: `${plural(s.open, "open PR")}: open the list on GitHub` })
      .tooltip("Open your open PRs on GitHub").child(`${num(s.open)} open`);
    const row = (b) => {
      const w = WAITING[b.key], one = b.count === 1 && b.first;
      const where = one ? prName(b.first) : "GitHub";
      return this.action(h_flex().mx(-6).px(4).py(4).gap(8).items_center().rounded(6), `waiting-${b.key}`,
        () => openUrl(one ? prUrl(b.first) : w.url), t, { label: `${w.label}: ${plural(b.count, "PR")}. Opens ${where}.` })
        .tooltip(one ? `Open ${b.first.repo}#${b.first.number} on GitHub` : `Open these ${b.count} PRs on GitHub`)
        .child(v_flex().flex_1().min_w(0)
          .child(div().min_w(0).truncate().text_size(12).text_color(ink.label).child(w.label))
          .when(Boolean(one), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(ink.hint).child(prName(b.first)))))
        .child(div().flex_none().text_size(16).font_semibold().text_color(w.tone ? ink[w.tone] : t.foreground).child(num(b.count)));
    };
    const o = s.oldestOpen, staleOne = s.stale === 1 && o;
    const stale = s.stale > 0 && this.action(h_flex().mx(-6).px(4).py(4).gap(6).rounded(6).text_size(11), "stale",
      () => openUrl(staleOne ? prUrl(o) : search(`author:@me sort:created-asc created:<${new Date(Date.now() - STALE_PR_DAYS * 86400000).toISOString().slice(0, 10)}`)), t,
      { label: `${plural(s.stale, "PR")} open over ${STALE_PR_DAYS} days; the oldest is ${o.repo}#${o.number}, open ${plural(s.oldestOpenDays, "day")}. Opens ${staleOne ? "it" : "them, oldest first"}.` })
      .tooltip(staleOne ? `Open ${o.repo}#${o.number} on GitHub` : "Open them on GitHub, oldest first")
      .child(div().flex_none().text_color(ink.label).child(`${num(s.stale)} stale`))
      .child(div().min_w(0).truncate().text_color(ink.hint).child(`open over ${STALE_PR_DAYS} days · oldest ${prName(o)}, ${plural(s.oldestOpenDays, "day")}`));
    const body = v_flex()
      .when(rows.length === 0, (e) => e.child(div().text_size(12).text_color(ink.label).child(s.open ? "Nothing waits on you right now." : "No open PRs, and no reviews asked of you.")))
      .children(rows.map(row))
      .when(Boolean(stale), (e) => e.child(div().mt(4).pt(4).border_t(1).border_color(t.border).child(stale)));
    return this.card("Waiting on you", null, body, t, ink, s.open ? all : null);
  }

  // One magnitude per repo: a single hue, longest first, the number beside each bar. The bar has no
  // track: the longest one is the scale. A row opens your PRs in that repo. The owner shows only when
  // two listed repos share a name.
  repoList(repos, t, ink) {
    if (!repos.length) return div().text_size(11).text_color(ink.hint).child("No merged PRs in the last 30 days.");
    const max = Math.max(1, ...repos.map((r) => r.merged));
    const shown = this.allRepos ? repos : repos.slice(0, TOP_REPOS), rest = repos.slice(TOP_REPOS);
    const restPrs = rest.reduce((n, r) => n + r.merged, 0);
    const names = shown.map((r) => r.repo.split("/")[1]);
    const name = (r, i) => (names.filter((x) => x === names[i]).length > 1 ? r.repo : names[i]);
    return v_flex().gap(2)
      .children(shown.map((r, i) => this.action(v_flex().mx(-6).px(4).py(4).gap(3).rounded(6), `repo-${r.repo}`,
        () => openUrl(`${GH}/${r.repo}/pulls?q=is%3Apr+author%3A%40me`), t,
        { label: `${r.repo}: ${plural(r.merged, "PR")} merged, ${plural(r.commits, "commit")}. Opens your PRs there on GitHub.` })
        .tooltip(`${r.repo}: ${plural(r.merged, "PR")} merged, ${plural(r.commits, "commit")}. Opens your PRs there.`)
        .child(h_flex().gap(8).text_size(12)
          .child(div().flex_1().min_w(0).truncate().text_color(ink.label).child(name(r, i)))
          .child(div().flex_none().font_semibold().child(num(r.merged))))
        .child(div().h(6).rounded(3).bg(ink.bar).w(`${Math.max(2, Math.round(100 * r.merged / max))}%`))))
      .when(rest.length > 0, (e) => {
        const text = this.allRepos ? "Show fewer repos" : `Show ${plural(rest.length, "more repo")} · ${plural(restPrs, "PR")}`;
        return e.child(this.action(div().mx(-6).px(4).py(4).rounded(6).text_size(11).text_color(ink.label), "repos-more",
          () => { this.allRepos = !this.allRepos; }, t, { label: text, role: "button" }).child(text));
      });
  }

  // Claude against Codex: one split bar with 2px gaps for the share, then a small table with each
  // one's PRs and median time to merge, so the comparison is more than volume and color is never the
  // only label.
  aiSplit(ai, hours, t, ink) {
    const swatch = (p, h) => (p.key === "both"
      ? v_flex().h(h).rounded(2).overflow_hidden().child(div().flex_1().bg(ink.claude)).child(div().flex_1().bg(ink.codex))
      : div().h(h).rounded(2).bg(p.color));
    const parts = [
      { key: "claude", label: "Claude", color: ink.claude, n: ai.claude },
      { key: "codex", label: "Codex", color: ink.codex, n: ai.codex },
      { key: "both", label: "Both", n: ai.both },
      { key: "none", label: "No AI mark", color: ink.hint, n: ai.none },
    ].filter((p) => p.n > 0);
    const made = ai.claude + ai.codex + ai.both;
    const pct = ai.total ? Math.floor(100 * made / ai.total) : null; // floor: 845 of 848 is not 100%
    const define = "An AI mark is a Claude or Codex co-author trailer, sign-off line or branch name on the PR.";
    const cols = (a, b, c, e = h_flex()) => e.gap(8).items_center()
      .child(h_flex().flex_1().min_w(0).gap(6).items_center().children(Array.isArray(a) ? a : [a]))
      .child(div().w(44).flex_none().text_right().child(b))
      .child(div().w(56).flex_none().text_right().child(c));
    return v_flex().id("ai").gap(6).pt(8).border_t(1).border_color(t.border).tooltip(define)
      .accessibility_label(`Claude against Codex, last 30 days. ${parts.map((p) => `${p.label}: ${plural(p.n, "PR")}, median ${duration(hours?.[p.key])} to merge`).join(". ")}. ${define}`)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(ink.label).child("Claude vs Codex"))
        .child(div().flex_none().text_size(11).text_color(ink.hint).child(pct == null ? "no PRs to rate" : `${pct}% with an AI mark`)))
      .when(parts.length > 0, (e) => e
        .child(h_flex().h(8).gap(2).children(parts.map((p) => swatch(p, 8).id(`ai-${p.key}`)
          .flex_grow(p.n).flex_basis(0).min_w(3).tooltip(`${p.label}: ${plural(p.n, "PR")}`))))
        .child(v_flex().gap(3).text_size(11)
          .child(cols("", "PRs", "to merge", h_flex().text_size(10).text_color(ink.hint)))
          .children(parts.map((p) => cols([swatch(p, 8).w(8).flex_none(), div().min_w(0).truncate().text_color(ink.label).child(p.label)],
            num(p.n), duration(hours?.[p.key]))))));
  }

  // A number with its comparison under the label, so the comparison keeps its words in a narrow panel.
  row(label, value, sub, t, ink, first = false) {
    return v_flex().gap(1).py(6).when(!first, (e) => e.border_t(1).border_color(t.border))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(ink.label).child(label))
        .child(div().flex_none().font_semibold().child(value)))
      .when(sub != null, (e) => e.child(typeof sub === "string"
        ? div().min_w(0).truncate().text_size(11).text_color(ink.hint).child(sub) : sub));
  }

  body(s, t, ink) {
    const weeks = s.weeks, last = weeks.length - 1, p = s.pace;
    const before = "the 30 days before";
    const repos = s.repos.filter((r) => r.commits > 0).length;
    const rate = s.decided ? `${s.mergeRate}% merged of ${plural(s.decided, "PR")} closed` : "No PRs closed yet";
    return v_flex().gap(10)
      .child(this.hero(s, t, ink))
      .child(this.waiting(s, t, ink))
      .child(this.card("Last 12 weeks", "PRs merged · releases to main not counted",
        this.bars("wk", weeks.map((w) => ({ ...w, value: w.merged })), {
          height: 100, now: last, ghost: p?.projected ?? null,
          label: (w, n) => (n === last ? "now" : n % 3 === 0 ? short(w.start) : ""),
          summary: `PRs merged per week: ${weeks.map((w, n) => (n === last ? `this week ${w.merged} so far${p?.projected > w.merged ? `, heading for about ${p.projected}` : ""}` : `${short(w.start)} ${w.merged}`)).join(", ")}.`,
          tip: (w) => (w === weeks[last] && p?.projected != null
            ? `This week so far: ${plural(w.merged, "PR")}, heading for about ${num(p.projected)}`
            : `Week of ${short(w.start)}: ${plural(w.merged, "PR")} merged`),
        }, t, ink), t, ink))
      .child(this.card("Last 30 days", "all your repos", v_flex()
        .child(this.row("PRs merged", num(s.merged30), this.line(versus(change(s.merged30, s.mergedPrev30), before, "more"), ink), t, ink, true))
        .child(this.row("Median time to merge", duration(s.medianHours),
          this.line(versus(change(s.medianHours, s.prevMedianHours, { format: duration, words: TIME_WORDS }), before, "less"), ink), t, ink))
        .child(this.row("Reviews of others' PRs", num(s.reviews.last30), this.line(versus(change(s.reviews.last30, s.reviews.prev30), before), ink), t, ink))
        // Commits and merge rate support the PR numbers above, so they share one quieter line.
        .child(h_flex().flex_wrap().gap_x(12).gap_y(2).pt(6).pb(8).border_t(1).border_color(t.border).text_size(11).text_color(ink.hint)
          .child(`${plural(s.commits30, "commit")} from your account in ${plural(repos, "repo")}`)
          .child(rate))
        .child(this.aiSplit(s.ai, s.aiHours, t, ink)), t, ink))
      .child(this.card("By repo", "PRs merged · last 30 days", this.repoList(s.repos, t, ink), t, ink));
  }

  // A verdict line, or `fallback` in the hint color when there is nothing to compare with.
  line(v, ink, fallback = null) {
    return v ? this.verdict(v, ink) : fallback;
  }

  render(cx) {
    const t = theme(), ink = inks(t), s = this.cache?.stats;
    this.ink = ink; this.actions = [];
    const stale = Boolean(this.cache) && Date.now() - this.cache.at > STALE;
    const focused = this.handle.is_focused();
    // One status, in the header: what the panel is doing, or how old the numbers are when a refresh
    // failed. The first load says nothing here: the body explains it.
    const status = this.loading ? (this.cache ? "Refreshing…" : "")
      : this.error && this.cache ? `Couldn't refresh · numbers from ${ago(this.cache.at)}`
        : this.cache ? `updated ${ago(this.cache.at)}` : "";
    const warn = !this.loading && (Boolean(this.error) || stale);
    const refresh = this.action(div().px(8).h(24).flex().items_center().rounded(6).bg(t.raised).text_size(11)
      .text_color(this.loading ? ink.hint : ink.button), "stats-refresh", (cx) => this.load(cx), t,
      { label: this.loading ? "Refreshing" : "Refresh now", role: "button" })
      .disabled(Boolean(this.loading)).tooltip("Refresh now (R when the panel has the keyboard)").child("Refresh");
    const body = v_flex().id("stats-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(10)
      .when(Boolean(this.error), (e) => e.child(div().px(2).text_size(11).text_color(s ? ink.headerWarn : readable(t.ansi1, t.background, 4.5)).child(this.error)))
      .when(!s && !this.error, (e) => e.child(div().p(4).text_color(ink.header).child("Loading your numbers from GitHub… the first load takes about 15 seconds.")))
      .when(Boolean(s), (e) => e.child(this.body(s, t, ink)));
    this.at = Math.min(this.at, Math.max(0, this.actions.length - 1));
    return v_flex().id("stats").role("pane").accessibility_label("Your stats").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Your stats"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(warn ? ink.headerWarn : ink.header).child(status))
        .child(refresh.flex_none()))
      // The keys, shown only while the panel has the keyboard.
      .when(focused, (e) => e.child(div().flex_none().px(12).py(4).border_b(1).border_color(t.border).truncate()
        .text_size(10).text_color(ink.header).child("↑ ↓ move · Enter opens · R refreshes · Esc leaves")))
      .child(body);
  }
}
