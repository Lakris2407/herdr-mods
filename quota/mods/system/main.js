// System: CPU, RAM and disk load as Task Manager shows them, always visible in the status bar. Click it for details.
// The same mod draws the popup (props().popup). Samples stay in the instance, never in shared state.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { exec, hc, theme, settings, props, agents, spaces, openOverlay, home, readTextFile } from "herdr";
import {
  liveArgs, livePath, SCAN, TOTAL_MEMORY, REMOTE_SCRIPT, STATUS, parseTypeperf, parseRemote, remoteSample, parseTotalMemory, summarize, meterLevel, meters,
  memoryPct, htmlText, valuesLine, healthLine, agentLines, agentsInOrder, straysLine, workingLine, isCodex, parseScan, parseSubagents, analyze, size, age, gb, speed, outsideLine, rowText, popupText,
} from "./logic.js";

const TICK = 1500, REMOTE_EVERY = 2000, RESTART_GAP = 5000, SMOOTH = 2, SCAN_EVERY = 5 * 60000, TOTAL_RETRY = 60000, STALE = 10000;
const FONT = "JetBrains Mono", TRACK = "#3b404a";
const METER = 44, POPUP_WIDTH = 620, POPUP_LINE = 370;

function color(level) {
  const dark = settings().dark !== false;
  return (dark ? ["#5ed49a", "#f2c14e", "#f2665c"] : ["#1f9d63", "#c98a0b", "#d64545"])[level];
}

const COPIED_FOR = 1500;

const activeMachine = () => spaces().find((s) => s.active)?.machine ?? null;

export default class System extends View {
  init(_props, cx) {
    this.pids = {};
    this.procs = null; // the popup scans on its own: only a scan just now knows who still runs
    this.scanning = false;
    this.totalGB = null;
    this.copied = false;
    this.generation = 0;
    this.remoteBusy = false;
    this.remoteAt = 0;
    this.previous = null;
    if (props()?.popup) {
      const s = props().snapshot ?? {};
      this.sample = s.sample ?? null;
      this.pids = { ...(s.pids ?? {}) };
      this.totalGB = s.totalGB ?? null;
      this.path = livePath(home());
      this.machine = s.machine ?? null;
      this.label = s.label ?? null;
      if (this.machine != null) {
        this.collectRemote(cx, Date.now());
        cx.timer.every(TICK, (cx) => this.tickRemote(cx));
        return;
      }
      this.rescan(cx);
      this.read(cx);
      cx.timer.every(TICK, (cx) => { if (!this.reading) this.read(cx); }); // reads the same file: no process of its own
      return;
    }
    this.sample = null;
    this.path = livePath(home());
    this.machine = activeMachine();
    this.label = null;
    if (this.machine != null) this.findLabel(cx);
    this.sampling = false;
    this.reading = false;
    this.startedAt = 0;
    this.tail = null;
    this.shown = "";
    this.scannedAt = 0;
    this.stale = false;
    this.tick(cx);
    cx.timer.every(TICK, (cx) => this.tick(cx));
  }

  // A space on another machine shows that machine: nothing from the laptop stays on screen, and a late answer is dropped.
  switchTo(on, cx) {
    this.machine = on;
    this.generation++;
    this.sample = null;
    this.previous = null;
    this.tail = null;
    this.remoteBusy = false;
    this.label = null;
    if (on != null) { this.findLabel(cx); this.collectRemote(cx, Date.now()); }
  }

  findLabel(cx) {
    const on = this.machine;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        const found = JSON.parse(r.stdout).machines?.find((m) => m.name === on || m.id === on);
        if (on === this.machine) { this.label = found?.host ?? on; cx.notify(); }
      } catch (e) { console.log(`system label: ${e}`); }
    });
  }

  collectRemote(cx, now) {
    const on = this.machine, generation = this.generation;
    this.remoteBusy = true;
    this.remoteAt = now;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", REMOTE_SCRIPT], { on });
        const cur = r.code === 0 ? parseRemote(r.stdout) : null;
        if (generation === this.generation && cur) {
          if (cur.os !== "Linux") this.sample = null;
          else { this.sample = remoteSample(this.previous, cur, Date.now()); this.previous = cur; }
        }
      } catch (e) { console.log(`system remote: ${e}`); } // the last good sample stays and ages
      if (generation === this.generation) { this.remoteBusy = false; this.redrawIfChanged(cx); }
    });
  }

  tickRemote(cx) {
    try {
      const now = Date.now();
      if (!this.remoteBusy && now - this.remoteAt >= REMOTE_EVERY) this.collectRemote(cx, now);
      this.redrawIfChanged(cx);
    } catch (e) { console.log(`system remote tick: ${e}`); }
  }

  total() { return this.sample?.remoteTotalGB ?? this.totalGB; }

  redrawIfChanged(cx) {
    const key = [...meters(this.sample, this.total()).map((m) => m.text), this.isStale(Date.now())].join("|");
    if (props()?.popup || key !== this.shown) { this.shown = key; cx.notify(); }
  }

  // typeperf writes the file; each tick only reads it, and redraws only when something on screen would change.
  tick(cx) {
    try {
      if (this.machine != null) { this.tickRemote(cx); return; }
      const now = Date.now();
      if (!this.sampling && now - this.startedAt >= RESTART_GAP) this.collect(cx, now);
      const scanDue = this.totalGB == null ? TOTAL_RETRY : SCAN_EVERY;
      if (!this.scanning && now - this.scannedAt >= scanDue) { this.scannedAt = now; this.rescan(cx); }
      if (!this.reading) this.read(cx);
    } catch (e) { console.log(`system tick: ${e}`); }
  }

  isStale(now) { return !this.sample || now - this.sample.at > STALE; }

  collect(cx, now) {
    this.sampling = true;
    this.startedAt = now;
    cx.spawn(async () => {
      try { await exec("typeperf", liveArgs(this.path)); }
      catch (e) { console.log(`system sample: ${e}`); }
      this.sampling = false;
    });
  }

  read(cx) {
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.path);
        const tail = text?.slice(-80) ?? null, rows = parseTypeperf(text); // an unchanged file is a stopped typeperf: the data ages
        if (this.machine == null && rows.length && tail !== this.tail) { this.tail = tail; this.sample = summarize(rows.slice(-SMOOTH), Date.now()); }
      } catch (e) { console.log(`system read: ${e}`); } // the last good sample stays
      this.reading = false;
      this.redrawIfChanged(cx);
    });
  }

  rescan(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        if (this.totalGB == null) {
          const m = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", TOTAL_MEMORY]).catch(() => null);
          this.totalGB = parseTotalMemory(m?.stdout);
        }
        const live = agents().map((a) => a.address).filter((a) => !a.includes("/"));
        const pids = {};
        for (const address of live) {
          if (this.pids[address] != null) { pids[address] = this.pids[address]; continue; }
          const r = await hc(["get", address, "--json"]).catch(() => null);
          try { const pid = JSON.parse(r?.stdout ?? "null")?.pid; if (Number.isInteger(pid)) pids[address] = pid; } catch {}
        }
        const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", SCAN]);
        const list = parseScan(r.stdout);
        if (list) {
          this.procs = analyze(list, pids, agents().filter(isCodex).map((a) => a.address), parseSubagents(r.stdout) ?? []);
          // A terminal revived after a core restart keeps its address but not its pid: ask again next scan.
          this.pids = Object.fromEntries(Object.entries(pids).filter(([a]) => this.procs.agentBytes[a] != null));
        }
      } catch (e) { console.log(`system scan: ${e}`); } // the last good scan stays
      this.scanning = false;
      cx.notify();
    });
  }

  open() {
    const remote = this.machine != null, lines = agents().length + (this.procs?.strays?.length ?? 0) + 1;
    openOverlay({
      mod: "system", kind: "popup", width: POPUP_WIDTH, height: remote ? 220 : Math.min(680, 300 + lines * 22),
      props: { popup: true, snapshot: { sample: this.sample, pids: this.pids, totalGB: this.totalGB, machine: this.machine, label: this.label } },
    });
  }

  copy(cx, text) {
    cx.write_to_clipboard(text);
    this.copied = true;
    cx.notify();
    cx.timer.after(COPIED_FOR, (cx) => { this.copied = false; cx.notify(); });
  }

  render(cx) {
    const t = theme();
    try {
      if (!props()?.popup && activeMachine() !== this.machine) this.switchTo(activeMachine(), cx);
      return props()?.popup ? this.details(t) : this.row(t);
    } catch (e) {
      console.log(`system render: ${e}`);
      return div().id("system-failed").size_full().px(10).flex().items_center().bg(t.chrome).border_t(1).border_color(t.border)
        .text_size(11.5).text_color(t.dim).child("System unavailable");
    }
  }

  bar(t, width, height, pct, fill) {
    return div().relative().w(width).h(height).flex_none().rounded(2).overflow_hidden().bg(settings().dark !== false ? TRACK : t.border)
      .when(pct != null, (el) => el.child(div().absolute().left(0).top(0).h(height).w((width * pct) / 100).bg(fill)));
  }

  meter(t, m, width) {
    const fill = m.level == null ? t.dim : color(m.level);
    return h_flex().flex_none().gap(5).items_center()
      .child(div().flex_none().text_color(t.foreground).child(m.label))
      .child(this.bar(t, width, 6, m.pct, fill))
      .child(div().w(33).flex_none().whitespace_nowrap().text_right().text_color(fill).child(m.text));
  }

  row(t) {
    const s = this.sample, now = Date.now(), stale = this.isStale(now);
    const strays = this.procs?.strays?.length ?? 0;
    const tip = [
      !s ? "Measuring…" : "Click for details",
      s && stale ? `Stale data, updated ${Math.round((now - s.at) / 1000)}s ago` : null,
      strays ? `Stray processes: ${strays}` : null,
    ].filter(Boolean).join("\n");
    return h_flex().id("system").size_full().px(8).gap(14).items_center().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).font_family(FONT).text_size(13).font_weight(500).cursor_pointer()
      .tooltip(tip).when(stale, (el) => el.opacity(0.6)).on_click(() => this.open())
      .on_mouse_down("right", (_e, cx) => this.copy(cx, rowText(s, this.total())))
      .when(this.copied, (el) => el.child(div().flex_none().text_color(t.foreground).child("Copied")))
      .when(!this.copied, (el) => el.children(meters(s, this.total()).map((m) => this.meter(t, m, METER))));
  }

  details(t) {
    const s = this.sample, p = this.procs, now = Date.now();
    const remote = this.machine != null, mem = s ? memoryPct(s, this.total()) : null;
    const selectable = (id, lines, c = t.foreground) => v_flex().w_full().text_color(c)
      .children(lines.map((x, i) => TextView.html(`system-${id}-${i}`, htmlText(x)).selectable(true)));
    const resource = (name, pct, note) => {
      const level = meterLevel(pct), fill = level == null ? t.dim : color(level);
      return h_flex().gap(8).items_center().h(24)
        .child(div().w(82).flex_none().truncate().child(name))
        .child(div().w(82).flex_none().truncate().text_size(12).text_color(t.dim).child(note))
        .child(this.bar(t, POPUP_LINE, 8, pct, fill))
        .child(div().w(40).flex_none().whitespace_nowrap().text_right().text_color(fill).child(pct == null ? "—" : `${Math.round(pct)}%`));
    };
    const heading = (text) => div().pt(7).text_size(12).text_color(t.dim).child(text);
    const list = agentsInOrder(agents());
    const text = () => popupText({ s, totalGB: this.total(), list, procs: p, label: remote ? this.label ?? this.machine : undefined });
    return v_flex().id("system-details").w_full().p(11).gap(3).bg(t.popover).font_family(FONT).text_size(13).overflow_y_scrollbar()
      .child(div().pb(2).text_size(15).font_weight(600).child(selectable("top", [remote ? this.label ?? this.machine : workingLine(list, p?.subagents, p?.clineRunning, p?.codexRuns)])))
      .child(h_flex().pb(4).items_center().justify_between().text_size(12).text_color(t.dim)
        .child(s ? `updated ${Math.round((now - s.at) / 1000)}s ago` : "Measuring…")
        .child(div().id("system-copy").px(8).rounded(4).cursor_pointer().bg(t.border).text_color(t.foreground)
          .on_click((_e, cx) => this.copy(cx, text())).child(this.copied ? "Copied" : "Copy")))
      .when(Boolean(s), (el) => el
        .child(resource("CPU", s.cpuNow, ""))
        .child(resource("Memory", mem, `${gb(s.availableGB)} free`))
        .child(resource("Disk", s.diskPct, speed(s.diskMBs)))
        .child(resource(remote ? "Storage /" : "Storage C:", s.usedCPct, `${gb(s.freeCGB)} free`))
        .when(!remote, (el) => el.child(resource("Storage D:", s.usedDPct, `${gb(s.freeDGB)} free`)))
        .child(div().pt(3).text_size(12).child(selectable("values", remote ? [valuesLine(s, this.total())] : [valuesLine(s, this.total()), healthLine(s)], t.dim))))
      .when(!remote, (el) => el
        .child(heading("Agents"))
        .child(selectable("agents", agentLines(list, p)))
        .child(div().h(5))
        .child(selectable("outside", [`Outside Herdr: ${p ? outsideLine(p) : "scanning…"}`], p ? t.foreground : t.muted))
        .when(Boolean(straysLine(p)), (el) => el.child(selectable("strays", [straysLine(p)], color(1)))));
  }
}
