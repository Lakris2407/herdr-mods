// Agent quota in the status bar: one slim bar per limit window, from `quota-axi --json`.
// Click it for details and options. The same mod draws the popup (props().menu).
import { visibleWindows } from "./quota-windows.js";
import { roles, level, readable } from "./colors.js";
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { loadQuota } from "./quota-data.js";
import { PERIODS, shortModel, money, creditUsed } from "./openrouter.js";
import { exec, theme, settings, shared, setShared, props, openOverlay, knownAgents, nextCommand, spaces, run } from "herdr";

const EVERY = 120000, STALE = 10 * 60000;
const DEFAULTS = { kinds: { session: true, weekly: true, monthly: true, model: false }, hidden: [], signedOut: false, names: false, remaining: false, spendPeriod: "day" };
const ICONS = { claude: "claude", codex: "codex", grok: "grok", kimi: "kimi", copilot: "copilot", cursor: "cursor" };
// OpenRouter (DeepSeek) has no app icon: the mod ships its own glyph, in baby blue.
const FILES = { openrouter: "mods/quota/deepseek.svg" };
const TINT = { claude: "#d97757", kimi: "#1783ff", copilot: "#8f6bf2", openrouter: "#8ecdf7" };
const KINDS = [["session", "5-hour limit"], ["weekly", "Weekly limit"], ["monthly", "Monthly limit"], ["model", "Model limits"]];

// Layout props set the starting options (`{"mod": "quota", "props": {"hidden": ["cursor"]}}`); the popup's choices win.
function options() {
  const start = props()?.menu ? props().start ?? {} : props() ?? {}, saved = shared("quota.options") ?? {};
  return { ...DEFAULTS, ...start, ...saved, kinds: { ...DEFAULTS.kinds, ...(start.kinds ?? {}), ...(saved.kinds ?? {}) } };
}
const setOptions = change => setShared("quota.options", { ...options(), ...change });
const signedIn = p => p.windows.length > 0 || Boolean(p.spend);
const period = o => PERIODS.find(x => x[0] === o.spendPeriod) ?? PERIODS[0];
const quotaMachine = () => props()?.menu ? props().machine ?? null : spaces().find(s => s.active)?.machine ?? null;
const stateKey = (name, on = quotaMachine()) => `${name}:${JSON.stringify(on)}`;

// Two windows of one kind (Cursor's monthly ones) are told apart by their own label.
function short(w, twin) {
  if (twin) return (w.label ?? w.kind).split(" ")[0].slice(0, 6);
  if (w.kind === "session") return w.windowSeconds ? `${Math.round(w.windowSeconds / 3600)}h` : "5h";
  if (w.kind === "weekly") return "wk";
  if (w.kind === "monthly") return "mo";
  return (w.label ?? "model").split(" ")[0].slice(0, 6);
}

// Share of the window already gone, 0..1; null without a reset time.
function elapsed(w, now) {
  if (!w.resetsAt || !w.windowSeconds) return null;
  const left = (Date.parse(w.resetsAt) - now) / 1000;
  return Math.min(1, Math.max(0, 1 - left / w.windowSeconds));
}

function until(iso, now) {
  const min = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ${min % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ago(at, now) {
  const min = Math.round((now - at) / 60000);
  return min < 1 ? "just now" : `${min}m ago`;
}

function pace(w, now) {
  const e = elapsed(w, now);
  if (e === null || e < 0.03) return null;
  const diff = Math.round(w.percentUsed - e * 100);
  return { diff, ahead: diff >= 10 && w.percentUsed >= 20 };
}

const percent = (w, remaining) => remaining && !w.shareOf ? 100 - w.percentUsed : w.percentUsed;
const percentText = (w, remaining) => `${Math.round(percent(w, remaining))}% ${remaining && !w.shareOf ? "remaining" : "used"}`;

// Calm until it matters (colors.js): green, amber from 60%, orange from 80%, red from 92%, when a limit is close.
function bar(w, width, height, now, t, remaining, r) {
  const e = elapsed(w, now), pct = Math.min(100, Math.max(0, percent(w, remaining)));
  return div().relative().w(width).h(height).flex_none().rounded(height / 2).bg(r.track)
    .child(div().absolute().left(0).top(0).h(height).w(Math.max(pct > 0 ? height : 0, width * pct / 100)).rounded(height / 2).bg(level(w.percentUsed, r)))
    .when(e !== null, el => el.child(div().absolute().top(-2).h(height + 4).w(1).left(Math.round(width * (remaining && !w.shareOf ? 1 - e : e))).bg(t.foreground).opacity(0.45)));
}

export default class Quota extends View {
  init(_props, cx) {
    // The app's program table knows each agent's icon and whether it is a one-color glyph.
    this.programs = {};
    this.loading = new Set();
    cx.spawn(async cx => {
      const list = await knownAgents().catch(() => []);
      for (const a of list) this.programs[a.key] = a;
      cx.notify();
    });
    if (props()?.menu) return;
    this.handle = cx.focus_handle();
    this.machine = quotaMachine();
    this.refresh(cx);
    cx.timer.every(EVERY, cx => this.refresh(cx));
    // Key commands: "quota:menu" opens the popup, "quota:refresh" reads the quota now.
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "menu") this.openMenu();
        if (c === "refresh") this.refresh(cx);
      }
    });
  }

  // pane.go can land here, as on the runners chip: Enter or Space does what a click does.
  focus() { this.handle?.focus(); }

  key(e, cx, act) {
    const k = e.keystroke;
    if (k === "enter" || k === "space") act();
    else if (k === "escape") run("pane.go", { direction: "up" });
    else if (["up", "left", "right"].includes(k)) run("pane.go", { direction: k });
    else return;
    cx.stop_propagation();
  }

  glyph(p, size, t) {
    const program = this.programs[p.id], icon = FILES[p.id] ?? program?.icon ?? (ICONS[p.id] ? `icons/${ICONS[p.id]}.svg` : null);
    if (!icon) return div().size(6).rounded(3).flex_none().bg(t.dim);
    const el = TINT[p.id] || !program || program.tint
      ? svg(icon).size(size).flex_none().text_color(TINT[p.id] ?? program?.color ?? t.foreground)
      : image(icon).size(size).flex_none().rounded(3);
    return signedIn(p) ? el : el.opacity(0.35);
  }

  refresh(cx) {
    const on = quotaMachine();
    if (this.loading.has(on)) return;
    this.loading.add(on);
    cx.spawn(async cx => {
      try {
        const data = await loadQuota(exec, on);
        setShared(stateKey("quota.data", on), data);
        setShared(stateKey("quota.error", on), data.error);
      }
      catch (e) { setShared(stateKey("quota.error", on), String(e.message ?? e)); }
      finally { this.loading.delete(on); cx.notify(); }
    });
  }

  openMenu() {
    const data = shared(stateKey("quota.data")), o = options();
    const all = data?.providers ?? [], shown = all.filter(p => !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut));
    const details = shown.reduce((n, p) => n + 30 + (p.spend ? 26 * 4 + 10 + (p.credits ? 36 : 0) : p.windows.length * 42), 0);
    const spend = all.some(p => p.spend) ? PERIODS.length * 32 + 26 : 0;
    const toggles = (KINDS.length + all.length + 3 + (all.some(p => p.id === "agy") ? 1 : 0)) * 32 + spend;
    openOverlay({ mod: "quota", kind: "popup", width: 300, height: Math.min(720, 44 + details + 40 + toggles + 77), props: { menu: true, machine: quotaMachine(), start: props() ?? {} } });
  }

  // Pay-as-you-go spend: model and dollars, no bars. Narrow bars drop the period word, then the model.
  spendItem(p, o, r, t, showModel, showPeriod) {
    const [key, name, word] = period(o), used = creditUsed(p), v = p.spend[key];
    const left = p.credits ? ` · ${money(p.credits.total - p.credits.used)} credit left` : "";
    const spoken = `${p.label}${p.model ? ` ${p.model}` : ""} ${money(v)} ${name.toLowerCase()}${left}`;
    const el = h_flex().id(`q-${p.id}`).gap(6).items_center().flex_none()
      .tooltip([`${p.label}${p.model ? ` · ${p.model}` : ""}`, ...PERIODS.map(([k, n]) => `${n}: ${money(p.spend[k])}`),
        ...(p.credits ? [`Credit left: ${money(p.credits.total - p.credits.used)} of ${money(p.credits.total)}`] : [])].join("\n"))
      .child(this.glyph(p, 12, t))
      .when(o.names, el => el.child(div().text_color(r.sub).child(p.label)))
      .when(showModel && Boolean(p.model), el => el.child(div().text_size(11).text_color(TINT.openrouter).child(shortModel(p.model))))
      .child(div().text_size(11).text_color(used !== null && used >= 80 ? level(used, r) : t.foreground).child(money(v)))
      .when(showPeriod, el => el.child(div().text_size(11).text_color(r.hint).child(word)));
    return { el, spoken };
  }

  spendDetails(p, r, t) {
    const used = creditUsed(p), row = (k, v, color = t.foreground) => h_flex().gap(8).items_center()
      .child(div().w(78).flex_none().text_size(12).text_color(r.sub).child(k))
      .child(div().flex_1().text_right().text_size(12).text_color(color).child(v));
    return v_flex().gap(4)
      .when(Boolean(p.model), el => el.child(div().px(8).py(5).rounded(6).bg(t.hover).text_size(11).text_color(TINT.openrouter).child(p.model)))
      .children(PERIODS.map(([k, n]) => row(n, money(p.spend[k]))))
      .when(used !== null, el => el
        .child(div().relative().w_full().h(4).my(2).rounded(2).bg(r.track)
          .child(div().absolute().left(0).top(0).h(4).w(`${Math.max(2, used)}%`).rounded(2).bg(used >= 80 ? level(used, r) : TINT.openrouter)))
        .child(row("Credit left", `${money(p.credits.total - p.credits.used)} of ${money(p.credits.total)}`, used >= 80 ? level(used, r) : t.foreground)));
  }

  render(cx) {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    const r = roles(t, t.chrome);
    const on = quotaMachine();
    if (on !== this.machine) { this.machine = on; this.refresh(cx); }
    const data = shared(stateKey("quota.data")), error = shared(stateKey("quota.error")), o = options(), now = Date.now();
    const stale = !data || now - data.at > STALE;
    const list = (data?.providers ?? []).filter(p => !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut));
    // Narrow status bar: shorter bars, then no bars, then percents only, so every provider shows.
    // The window label goes last: "25%" alone does not say which limit it is.
    const width = this.width ?? Infinity, need = list.reduce((n, p) => n + (p.spend ? 1 : p.windows.filter(x => o.kinds[x.kind] ?? false).length), 0);
    const per = need ? (width - 24 - list.length * 46) / need : Infinity;
    const barW = per >= 96 ? 34 : per >= 76 ? 20 : 0, labels = per >= 40;
    const parts = [], spoken = [];
    list.forEach((p, i) => {
      if (i > 0) parts.push(div().w(1).h(12).flex_none().bg(t.border));
      if (p.spend) { const s = this.spendItem(p, o, r, t, labels, barW > 0); spoken.push(s.spoken); parts.push(s.el); return; }
      const windows = visibleWindows(p, o).filter(w => o.kinds[w.kind] ?? false);
      spoken.push(windows.length ? `${p.label} ${windows.map(w => `${w.label} ${percentText(w, o.remaining)}`).join(", ")}` : `${p.label} not signed in`);
      parts.push(h_flex().id(`q-${p.id}`).gap(labels ? 9 : 6).items_center().flex_none()
        .tooltip(windows.map(w => `${p.label} ${w.label}: ${percentText(w, o.remaining)}${w.resetsAt && Date.parse(w.resetsAt) > now ? `, resets in ${until(w.resetsAt, now)}` : ""}`).join("\n") || `${p.label}: not signed in`)
        .child(h_flex().gap(5).items_center()
          .child(this.glyph(p, 12, t))
          .when(o.names || !(ICONS[p.id] || FILES[p.id]), el => el.child(div().text_color(signedIn(p) ? r.sub : r.hint).child(p.label))))
        .when(!signedIn(p), el => el.child(div().size(6).rounded(3).border_1().border_color(r.hint)))
        .children(windows.map(w => {
          const pc = pace(w, now);
          return h_flex().gap(5).items_center()
            .when(labels, el => el.child(div().text_size(11).text_color(r.hint).child(short(w, windows.filter(x => x.kind === w.kind).length > 1))))
            .when(barW > 0, el => el.child(bar(w, barW, 4, now, t, o.remaining, r)))
            .child(div().min_w(24).text_size(11).text_color(w.percentUsed >= 60 ? level(w.percentUsed, r) : r.sub).child(`${Math.round(percent(w, o.remaining))}%`))
            .when(Boolean(pc?.ahead), el => el.child(div().ml(-3).text_size(10).text_color(level(Math.max(60, w.percentUsed), r)).child("▲")));
        })));
    });
    return h_flex().id("quota").size_full().px(labels ? 12 : 8).gap(labels ? 11 : 7).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(r.sub).cursor_pointer()
      .on_size_change((size, cx) => { const w = size.width / (settings().zoom || 1); if (w !== this.width) { this.width = w; cx.notify(); } })
      .tooltip(`Quota on ${on ?? "this computer"}`)
      .role("button").accessibility_label(`Agent quota on ${on ?? "this computer"}: ${spoken.join("; ") || "nothing to show"}. Enter opens details.`)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, () => this.openMenu()))
      .when(this.handle.is_focused(), el => el.border_2().border_color(readable(t.accent, t.chrome, 3)))
      .when(stale, el => el.opacity(0.6))
      .on_click(() => this.openMenu())
      .on_mouse_down("right", () => this.openMenu())
      .when(parts.length === 0, el => el.child(div().text_color(r.hint).child(error ? "Quota unavailable" : data ? "No quota to show" : "Loading quota…")))
      .children(parts);
  }

  menu(t) {
    const r = roles(t, t.popover), data = shared(stateKey("quota.data")), error = shared(stateKey("quota.error")), o = options(), now = Date.now();
    const all = data?.providers ?? [];
    const toggle = (label, on, act, id) => h_flex().id(id).h(32).px(10).gap(10).rounded(6).items_center().cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(act)
      .child(div().flex_1().text_color(on ? t.foreground : r.sub).child(label))
      .child(div().size(16).flex_none().flex().items_center().justify_center()
        .when(on, el => el.child(svg("mods/quota/check.svg").size(16).text_color(t.accent))));
    const heading = text => div().px(8).pt(10).pb(4).text_size(11).text_color(r.hint).child(text);
    const details = all.filter(p => !o.hidden.includes(p.id) && (signedIn(p) || o.signedOut)).map(p => v_flex().px(8).py(4).gap(4)
      .child(h_flex().gap(6).items_center()
        .child(this.glyph(p, 13, t))
        .child(div().font_semibold().text_color(t.foreground).child(p.label))
        .child(div().text_size(11).text_color(r.hint).child(signedIn(p) ? (p.plan ?? "") : p.error ?? "not signed in")))
      .when(Boolean(p.spend), el => el.child(this.spendDetails(p, r, t)))
      .children(visibleWindows(p, o).map(w => {
        const pc = pace(w, now);
        return v_flex().gap(3)
          .child(h_flex().gap(8).items_center()
            .child(div().w(62).flex_none().truncate().text_size(12).text_color(r.sub).child(w.kind === "session" ? "5 hours" : w.kind === "weekly" ? "Week" : w.label))
            .child(bar(w, 120, 5, now, t, o.remaining, r))
            .child(div().flex_1().text_right().text_size(12).text_color(w.percentUsed >= 60 ? level(w.percentUsed, r) : t.foreground).child(`${Math.round(percent(w, o.remaining))}%`)))
          .child(div().pl(70).text_size(11).text_color(r.hint).child([
            w.resetsAt && Date.parse(w.resetsAt) > now ? `resets in ${until(w.resetsAt, now)}` : null,
            pc ? (Math.abs(pc.diff) < 5 ? "on pace" : pc.diff > 0 ? `${pc.diff}% ahead of pace` : `${-pc.diff}% under pace`) : null,
          ].filter(Boolean).join(" · ")));
      })));
    return v_flex().id("quota-menu").w_full().p(5).bg(t.popover).text_size(12).overflow_y_scrollbar()
      .child(h_flex().px(8).pt(4).pb(2).items_center()
        .child(div().flex_1().text_size(11).text_color(r.hint).child(data ? `Quota ${o.remaining ? "remaining" : "used"} · ${ago(data.at, now)}` : "Agent quota"))
        .child(div().id("quota-refresh").px(6).rounded(5).cursor_pointer().text_size(11).text_color(r.sub).hover(s => s.bg(t.hover))
          .on_click((_event, cx) => this.refresh(cx)).child("Refresh")))
      .child(div().px(8).py(4).text_size(11).text_color(r.sub).child(`Machine: ${quotaMachine() ?? "This computer"}`))
      .when(Boolean(error), el => el.child(div().px(8).py(4).text_size(11).text_color(r.fail).child(error)))
      .children(details)
      .child(div().mx(8).my(6).h(1).bg(t.border))
      .child(toggle("Show remaining instead of used", o.remaining, () => setOptions({ remaining: !o.remaining }), "remaining"))
      .child(heading("Limits to show in the status bar"))
      .children(KINDS.map(([kind, label]) => toggle(label, o.kinds[kind], () => setOptions({ kinds: { ...o.kinds, [kind]: !o.kinds[kind] } }), `kind-${kind}`)))
      .when(all.some(p => p.spend), el => el
        .child(heading("Spend to show in the status bar"))
        .children(PERIODS.map(([k, n]) => toggle(n, period(o)[0] === k, () => setOptions({ spendPeriod: k }), `spend-${k}`))))
      .child(div().mx(8).my(6).h(1).bg(t.border))
      .child(heading("Providers"))
      .children(all.map(p => toggle(p.label, !o.hidden.includes(p.id),
        () => setOptions({ hidden: o.hidden.includes(p.id) ? o.hidden.filter(x => x !== p.id) : [...o.hidden, p.id] }), `prov-${p.id}`)))
      .when(all.some(p => p.id === "agy"), el => el.child(toggle("Antigravity: Claude/GPT limits", o.agyClaudeGpt !== false,
        () => setOptions({ agyClaudeGpt: o.agyClaudeGpt === false }), "agy-claude-gpt")))
      .child(toggle("Signed-out providers", o.signedOut, () => setOptions({ signedOut: !o.signedOut }), "signed-out"))
      .child(toggle("Provider names", o.names, () => setOptions({ names: !o.names }), "names"));
  }
}
