// A queue of notes and prompts in a side panel: write one now, send it to an agent when the agent is
// free. A note can carry files and pasted screenshots; Send pastes the text and the files' paths into
// the agent's terminal and presses Enter, Copy puts the same text on the clipboard.
// The notes live in ~/.config/herdr-app/queue.json (store.js); notes.js holds the logic and has no Herdr imports.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { theme, run, hc, shared, setShared, nextCommand, agents, spaces, focused, window, openOverlay, closeOverlay, props as blockProps } from "herdr";
import { randomUUID } from "crypto";
import { load, save, removeFile, clipboardFile, filesDir } from "./store.js";
import { demoNotes, demoAgent } from "./demo.js";
import {
  makeNote, add, edit, setDone, taken, removeMany, putBack, waiting, finished, filter, inSpace, dropped, owned, unique,
  fileName, isImage, promptText, preview, ago, plural, pickTarget, targetName, targetTitle, targetPlace, statusWord, sendError,
} from "./notes.js";
import { readable, roles } from "./colors.js";
import { leaveSide, imageSize, fit } from "./place.js";

// Another copy of the panel saved: every copy reads this stamp and loads the file again.
const REV = "queue.rev";
// A deleted note can come back for UNDO; the timer looks every TICK, so it is at most TICK longer.
const TICK = 3000, MINUTE = 60000, FLASH = 4000, UNDO = 8000;
// The search field shows once the list is long enough to need it.
const SEARCH_FROM = 6;

// The theme's own colors, lifted only where a theme sets them below a readable contrast (colors.js):
// labels at 6:1, hints at 4.5:1, the focus ring and a field's edge at 3:1. `card*` sit on a card
// (`raised`), the others on the panel (`background`).
function inks(t) {
  const top = roles(t, t.background), card = roles(t, t.raised);
  return {
    label: readable(t.muted, t.raised, 6),
    hint: readable(t.dim, t.raised, 4.5),
    ring: readable(t.accent, t.raised, 3),
    cardLine: card.line,
    cardFail: card.fail,
    header: top.hint,
    sub: top.sub,
    line: top.line,
    warn: top.warn,
    hot: top.hot,
    fail: top.fail,
    ok: top.ok,
  };
}

const stop = (_e, cx) => cx.stop_propagation();

// The key that adds a note from the field, as this platform writes it.
const addKey = () => (window()?.platform === "macos" ? "⌘↵" : "Ctrl+Enter");

const NOT_SAVED = "Not saved. The list still shows the last saved notes; your draft stays in the field.";

export default class Queue extends View {
  init(props, cx) {
    // The same mod is the large view of one pasted image (see preview()).
    this.viewer = (props ?? blockProps())?.viewer ?? null;
    if (this.viewer) return;
    // `{ "demo": true }` in the block's props: made-up notes for screenshots; nothing is read, saved or sent.
    this.demo = Boolean((props ?? blockProps())?.demo);
    this.notes = this.demo ? demoNotes() : [];
    try { this.all = !this.demo && localStorage.getItem("scope") === "all"; } catch { this.all = false; }
    this.fileText = null;   // the file as last read or written: what the next save expects to replace
    this.ready = this.demo;
    this.files = [];        // the composer's files
    this.editing = null;    // the id of the note the composer holds
    this.stash = null;      // the unsent draft, set aside while a note is edited
    this.trash = null;      // the notes Delete just took: { gone: [{ note, index }], until }
    this.failed = new Map(); // note id -> why its last Send failed, shown on the note until it is sent or dismissed
    this.unsaved = null;    // why the last change is not on disk
    this.expanded = new Set();
    this.query = "";
    this.field = null;      // the text field that has the keyboard: "draft", "search" or null
    this.picking = false;   // the list of agents is open
    this.hold = false;      // the target was picked in the panel: it holds until the keyboard leaves the panel
    // The keyboard cursor is the id of a registered action, so it stays on its button when the list changes.
    this.cur = "queue-add";
    this.actions = []; this.ids = []; this.groups = [];
    this.handle = cx.focus_handle();

    let draft = "";
    try { draft = this.demo ? "" : localStorage.getItem("draft") ?? ""; } catch {}
    this.draft = TextareaState.new({ value: draft, placeholder: "Add a note, a prompt or a task" });
    this.draft.set_auto_grow(2, 10);
    this.draft.on("change", (_e, cx) => { this.keepDraft(); cx.notify(); });
    // Enter is a new line; Cmd+Enter (Ctrl+Enter) adds the note.
    this.draft.on("submit", (e, cx) => { if (e.secondary) this.submit(cx); });
    this.draft.on("focus", (_e, cx) => { this.field = "draft"; cx.notify(); });
    this.draft.on("blur", (_e, cx) => { if (this.field === "draft") this.field = null; cx.notify(); });
    // A paste with no text: a screenshot, or a file copied in a file manager.
    this.draft.on("paste_other", (_e, cx) => this.pasteFile(cx));

    this.search = InputState.new({ placeholder: "Search notes" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.field = "search"; cx.notify(); });
    this.search.on("blur", (_e, cx) => { if (this.field === "search") this.field = null; cx.notify(); });

    if (!this.demo) this.reload(cx);
    let minute = Date.now();
    cx.timer.every(TICK, (cx) => {
      const now = Date.now();
      let draw = false;
      if (this.stale) { this.stale = false; this.reload(cx); }
      // "5m ago" stays true, a status line goes away when its time is up, and so does Undo.
      if (now - minute >= MINUTE) { minute = now; draw = true; }
      if (this.flash && now > this.flash.until) { this.flash = null; draw = true; }
      if (this.trash && now > this.trash.until) {
        this.emptyTrash();
        if (this.cur === "queue-undo") this.cur = "queue-add";
        draw = true;
      }
      if (draw) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "new") this.draft.focus();
        cx.notify();
      }
    });
  }

  reload(cx) {
    // A reload must not replace the snapshot while a write is in flight.
    if (this.saving || this.loading || this.sending) { this.stale = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const file = await load();
        this.notes = file.notes; this.fileText = file.text; this.ready = true; this.error = null;
      } catch (e) {
        this.ready = false;
        this.error = `${e.message ?? e}. Fix or remove the file, then retry; nothing is saved until then.`;
      } finally { this.loading = false; }
      cx.notify();
    });
  }

  say(text, tone = "plain") { this.flash = { text, tone, until: Date.now() + FLASH }; }

  // Publish a change only after its snapshot is on disk. While writing, controls are disabled;
  // a failed write leaves the composer intact and reloads the other window's version.
  commit(cx, change) {
    if (!this.ready || this.saving || this.loading) return Promise.resolve(false);
    const before = this.notes, after = change(before);
    if (this.demo) { this.notes = after; cx.notify(); return Promise.resolve(true); }
    this.saving = true;
    this.pendingNotes = after;
    cx.notify();
    return new Promise((done) => cx.spawn(async (cx) => {
      let saved = false;
      try {
        this.fileText = await save(after, this.fileText);
        this.notes = after;
        this.rev = randomUUID(); setShared(REV, this.rev);
        this.unsaved = null;
        const kept = new Set([...this.files, ...(this.stash?.files ?? []), ...(this.trash?.gone ?? []).flatMap((g) => g.note.files)]);
        for (const f of dropped(before, after)) if (owned(f, filesDir()) && !kept.has(f)) removeFile(f);
        saved = true;
      } catch (e) {
        this.unsaved = `${NOT_SAVED} ${e.message ?? e}`;
        this.ready = false;
        this.stale = true;
      } finally {
        this.saving = false; this.pendingNotes = null;
        cx.notify(); done(saved);
      }
    }));
  }

  keepDraft() {
    try { if (!this.demo && !this.editing) localStorage.setItem("draft", this.draft.value()); } catch {}
  }

  // Keep the draft (and its attachments) until the corresponding write succeeds. Typing while
  // saving is allowed: a newer draft must not be cleared by the earlier write's completion.
  submit(cx) {
    if (!this.ready || this.saving || this.loading || this.submitting || this.sending) return;
    const raw = this.draft.value(), text = raw.trim(), files = [...this.files], id = this.editing;
    if (!text && !files.length) return;
    this.submitting = true;
    cx.spawn(async (cx) => {
      // If another window removed the original, keep this edit as a new note.
      const saved = await this.commit(cx, (notes) => id && notes.some((n) => n.id === id)
        ? edit(notes, id, text, files)
        : add(notes, makeNote(randomUUID(), text, files, Date.now(), this.here)));
      if (saved && this.editing === id && this.draft.value() === raw &&
          this.files.length === files.length && this.files.every((f, i) => f === files[i])) {
        this.endEdit();
        if (id) this.cur = `edit-${id}`;
        else { try { if (!this.demo) localStorage.removeItem("draft"); } catch {} }
      }
      this.submitting = false;
      cx.notify();
    });
  }

  // Edit borrows the field: the draft you had not added is set aside, and comes back after.
  startEdit(note) {
    if (this.saving || this.loading || this.submitting || this.sending) return;
    if (this.editing) this.dropComposerFiles();
    else this.stash = { text: this.draft.value(), files: [...this.files] };
    this.editing = note.id; this.files = [...note.files];
    this.draft.set_value(note.text);
    this.draft.focus();
  }

  endEdit() {
    const back = this.stash ?? { text: "", files: [] };
    this.stash = null; this.editing = null; this.files = back.files;
    this.draft.set_value(back.text);
    this.keepDraft();
  }

  cancelEdit() {
    if (this.saving || this.submitting) return;
    const id = this.editing;
    this.dropComposerFiles();
    this.endEdit();
    this.cur = `edit-${id}`;
  }

  // A pasted image that no note holds goes from the disk when the composer lets go of it.
  dropComposerFiles(only = null) {
    if (this.demo) return;
    const held = new Set([...[...this.notes, ...(this.pendingNotes ?? [])].flatMap((n) => n.files), ...(this.stash?.files ?? [])]);
    for (const f of only ?? this.files) if (owned(f, filesDir()) && !held.has(f)) removeFile(f);
  }

  // Delete, with a way back: the notes leave the list and the file now, their pasted images only
  // when Undo's time is up. (If Herdr quits before that, the images stay in queue-files/.)
  deleteNotes(ids, cx) {
    if (!this.ready || this.saving || this.loading || this.sending) return;
    if (!ids.length) return;
    this.emptyTrash();
    this.trash = { gone: taken(this.notes, ids), until: Date.now() + UNDO };
    for (const id of ids) this.failed.delete(id);
    this.cur = "queue-undo";
    this.commit(cx, (notes) => removeMany(notes, ids));
  }

  undo(cx) {
    if (!this.ready || this.saving || this.loading || this.sending) return;
    const gone = this.trash?.gone ?? [];
    this.trash = null;
    if (!gone.length) return;
    this.cur = `restore-${gone[0].note.id}`;
    this.commit(cx, (notes) => putBack(notes, gone));
  }

  emptyTrash() {
    const gone = this.trash?.gone ?? [];
    this.trash = null;
    if (this.demo) return;
    const held = new Set([...[...this.notes, ...(this.pendingNotes ?? [])].flatMap((n) => n.files), ...this.files, ...(this.stash?.files ?? [])]);
    for (const f of unique(gone.flatMap((g) => g.note.files))) if (owned(f, filesDir()) && !held.has(f)) removeFile(f);
  }

  pasteFile(cx) {
    if (this.demo) return;
    cx.spawn(async (cx) => {
      const path = await clipboardFile(randomUUID()).catch(() => null);
      if (path) this.files = unique([...this.files, path]);
      else this.say("The clipboard holds no image and no file.", "warn");
      cx.notify();
    });
  }

  // A pasted image, large, over the window: Esc, a click on it or beside it closes it.
  preview(path, cx) {
    cx.spawn(async () => {
      const size = await imageSize(path);
      openOverlay({ mod: "queue", kind: "dialog", width: 0.9, height: 0.9, props: { viewer: { picture: `queue-files/${fileName(path)}`, size } } });
    });
  }

  viewerView(t) {
    const v = this.viewer, shown = fit(v.size, this.size, 32);
    return v_flex().id("queue-viewer").size_full().items_center().justify_center().bg(t.canvas).cursor_pointer()
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_click(() => closeOverlay(blockProps()?.overlay))
      .when(Boolean(shown), (e) => e.child(image(v.picture).w(shown.w).h(shown.h)));
  }

  // Where Send goes now: an agent, or null. The terminal you used last wins; an agent picked in the
  // panel holds while the panel has the keyboard, so pick, then Send.
  target() {
    if (this.demo) { this.tab = demoAgent.tab; return demoAgent; }
    const f = focused();
    this.tab = f?.tab ?? null;
    if (this.hold && !this.handle.is_focused() && !this.field) this.hold = false;
    if (!this.hold && f?.terminal) this.last = f.terminal;
    return pickTarget(agents(), this.last, this.tab);
  }

  pick(agent) {
    this.last = agent.address; this.hold = true; this.picking = false;
    this.cur = "queue-target";
    this.handle.focus();
  }

  send(note, target, cx) {
    if (!target || this.sending || this.saving || this.loading || !this.ready) return;
    this.failed.delete(note.id);
    if (this.demo) {
      this.cur = `restore-${note.id}`;
      this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now()));
      this.say(`Sent to ${target.program.name}`, "ok");
      return;
    }
    this.sending = note.id;
    cx.notify();
    cx.spawn(async (cx) => {
      // "--" ends hc's options, so a note that starts with a dash is still text.
      const r = await hc(["send", "--json", "--", target.address, promptText(note)]).catch((e) => ({ code: -1, stdout: "", stderr: "" }));
      this.sending = null;
      if (r.code === 0) {
        this.say(`Sent to ${targetName(target)}`, "ok");
        // The cursor goes to this note's Restore, not to the next note's Send: a second Enter never sends twice.
        if (this.cur === `send-${note.id}`) this.cur = `restore-${note.id}`;
        this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now()));
      } else {
        this.failed.set(note.id, sendError(r));
        this.say("Not sent", "fail");
      }
      cx.notify();
    });
  }

  copy(note, cx) {
    cx.write_to_clipboard(promptText(note));
    const what = note.files.length ? `Copied with ${plural(note.files.length, "file path")}` : "Copied";
    this.say(note.doneAt ? what : `${what}, and marked done`, "ok");
    if (!note.doneAt) { this.cur = `restore-${note.id}`; this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now())); }
  }

  // Everything you can act on registers here while the panel renders, in reading order, so the
  // keyboard walks the same list the mouse sees. `edge` is the 2px border's color when the cursor is
  // elsewhere: the surface the control sits on. `this.group` names the block the control is in (one
  // note, the field...), which is what J and K jump between.
  action(el, id, act, t, { label, role = "button", edge = t.raised, off = false } = {}) {
    off ||= Boolean(this.saving || this.loading || this.submitting || this.sending);
    this.actions.push(off ? () => {} : act); this.ids.push(id); this.groups.push(this.group);
    const cursor = id === this.cur && this.handle.is_focused();
    return el.id(id).role(role).disabled(off).when(Boolean(label), (e) => e.accessibility_label(label))
      .border_2().border_color(cursor ? this.ink.ring : edge).when(cursor, (e) => e.aria_active_descendant())
      .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.cur = id; if (!off) act(cx); cx.notify(); });
  }

  // The first control of the next block (dir 1) or of the one before (dir -1).
  jump(from, dir) {
    const g = this.groups;
    let i = from;
    while (g[i] !== undefined && g[i] === g[from]) i += dir;
    if (g[i] === undefined) return from;
    while (dir < 0 && i > 0 && g[i - 1] === g[i]) i--;
    return i;
  }

  key(e, cx) {
    // In a text field, Escape gives the keyboard back to the panel; every other key is text.
    if (this.field) {
      if (e.keystroke === "escape") { this.field = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const n = this.ids.length, at = Math.max(0, this.ids.indexOf(this.cur));
    const k = e.keystroke;
    if (k === "down" && n) this.cur = this.ids[(at + 1) % n];
    else if (k === "up" && n) this.cur = this.ids[(at + n - 1) % n];
    else if (k === "j" && n) this.cur = this.ids[this.jump(at, 1)];
    else if (k === "k" && n) this.cur = this.ids[this.jump(at, -1)];
    else if ((k === "enter" || k === "space") && n) this.actions[at]?.(cx);
    else if (k === "n") this.draft.focus();
    else if (k === "/" && this.searchShown) this.search.focus();
    else if (k === "escape" && this.picking) { this.picking = false; this.cur = "queue-target"; }
    else if (k === "escape") run("pane.go", { direction: leaveSide() });
    else if (k === "left" || k === "right") run("pane.go", { direction: k });
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  button(text, id, act, t, ink, { label = text, tip = null, strong = false, off = false, edge = t.raised } = {}) {
    const el = div().px(6).h(24).flex().flex_none().items_center().rounded(6).text_size(11)
      .text_color(off ? ink.hint : strong ? t.foreground : ink.label)
      .when(strong, (e) => e.bg(t.background).font_semibold());
    return this.action(el, id, act, t, { label, off, edge }).when(Boolean(tip), (e) => e.tooltip(tip)).child(text);
  }

  // A note's files: a pasted image as a thumbnail, any other file as its name. `onRemove` adds the ×
  // the composer needs.
  fileRow(files, key, t, ink, onRemove = null) {
    const x = (i) => this.action(div().w(22).h(24).flex().flex_none().items_center().justify_center().rounded(4).text_color(ink.label),
      `${key}-x-${i}`, (cx) => onRemove(i, cx), t, { label: `Remove ${fileName(files[i])}`, edge: t.background }).child("×");
    const dir = filesDir();
    return h_flex().flex_wrap().gap(4).items_center().children(files.map((path, i) => {
      const thumb = !this.demo && isImage(path) && owned(path, dir);
      return h_flex().id(`${key}-${i}`).min_w(0).max_w("100%").h(thumb ? 48 : 24).pl(thumb ? 0 : 6).pr(onRemove ? 0 : 6).gap(4).items_center()
        .rounded(5).overflow_hidden().bg(t.background).text_size(11).text_color(ink.label).tooltip(thumb ? "Click to see it large" : path)
        .when(thumb, (e) => e.child(this.action(div().flex_none().rounded(5), `${key}-img-${i}`, (cx) => this.preview(path, cx), t,
          { label: `Show ${fileName(path)} large`, edge: t.background }).child(image(`queue-files/${fileName(path)}`).h(44))))
        .when(!thumb, (e) => e.child(div().min_w(0).truncate().child(fileName(path))))
        .when(Boolean(onRemove), (e) => e.child(x(i)));
    }));
  }

  composer(t, ink) {
    this.group = "composer";
    const editing = Boolean(this.editing), typing = this.field === "draft";
    const empty = !this.draft.value().trim() && !this.files.length;
    const waits = Boolean(this.stash && (this.stash.text.trim() || this.stash.files.length));
    const hint = typing ? `${addKey()} ${editing ? "saves" : "adds"} · Esc leaves the field` : "Drop files here, or paste a screenshot";
    return v_flex().gap(8).p(10).rounded(8).bg(t.raised)
      .when(editing, (e) => e.child(div().text_size(11).text_color(ink.label).whitespace_normal()
        .child(waits ? "Editing a note. Your draft comes back when you save or cancel." : "Editing a note")))
      .child(div().id("queue-field").w_full().cursor_text().on_mouse_down("left", stop)
        .child(Textarea.new(this.draft).accessibility_label(editing ? "Edit the note" : "New note").w_full().px(8).py(6).rounded(6).border_1()
          .border_color(typing ? ink.ring : ink.cardLine).bg(t.background).text_color(t.foreground).text_size(13)))
      .when(this.files.length > 0, (e) => e.child(this.fileRow(this.files, "draft-file", t, ink, (i, cx) => {
        const [gone] = this.files.splice(i, 1);
        if (!this.editing) this.dropComposerFiles([gone]);
        this.cur = this.files.length ? `draft-file-x-${Math.min(i, this.files.length - 1)}` : "queue-add";
        cx.notify();
      })))
      .child(h_flex().gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(ink.hint).child(hint))
        .when(editing, (e) => e.child(this.button("Cancel", "queue-cancel", () => this.cancelEdit(), t, ink, { label: "Cancel the edit" })))
        .child(this.button(editing ? "Save" : "Add", "queue-add", (cx) => this.submit(cx), t, ink,
          { strong: !empty, off: empty, label: editing ? "Save the note" : "Add the note", tip: `${addKey()} in the field does the same` })));
  }

  // What the agent does, as a shape as well as a color: a ring when it is free, a filled dot when it
  // works (warm) or waits for you (red).
  dot(status, ink) {
    const d = div().size(7).flex_none().rounded(4);
    if (status === "blocked") return d.bg(ink.fail);
    if (status === "working") return d.bg(ink.hot);
    return d.border(1.5).border_color(ink.ok);
  }

  // The agent's mark: its program's icon (Claude, Codex), which says which one it is in less room than
  // the name. The status word beside it says what it does. A program with no icon keeps the dot.
  mark(agent, ink) {
    const p = agent.program;
    if (!p?.icon) return this.dot(agent.status, ink);
    return p.tint ? svg(p.icon).size(13).flex_none().text_color(ink.sub) : image(p.icon).w(13).h(13).flex_none();
  }

  // "Sends to [icon] Fix the checkout total  free", and with more than one agent a list to
  // pick another from. An agent in a tab you do not see gets a warning: Send presses Enter there.
  targetLine(target, list, t, ink) {
    this.group = "target";
    if (!target && !list.length) {
      return div().px(2).text_size(11).text_color(ink.header).whitespace_normal().child("No agent runs yet. Start one, and Send goes to it.");
    }
    const canPick = list.length > 1 || !target;
    const place = target ? targetPlace(target, this.tab) : "";
    const state = target ? statusWord(target.status) : "";
    let row = h_flex().mx(-4).px(4).h(24).gap(6).items_center().rounded(6).text_size(11)
      .child(div().flex_none().text_color(ink.header).child(target ? "Sends to" : "Choose where Send goes"))
      .when(Boolean(target), (e) => e
        .child(this.mark(target, ink))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(targetTitle(target)))
        .when(Boolean(state), (e) => e.child(div().flex_none().text_color(target.status === "blocked" ? ink.fail : ink.header).child(state))))
      .child(div().flex_1())
      .when(canPick, (e) => e.child(div().flex_none().text_color(ink.sub).child(this.picking ? "Close" : target ? "Change" : "Choose")));
    row = canPick
      ? this.action(row, "queue-target", () => { this.picking = !this.picking; }, t, {
        edge: t.background,
        label: target ? `Send goes to ${targetName(target)}${state ? `, ${state}` : ""}. Choose another agent` : "Choose the agent Send goes to",
      }).tooltip("Send goes to the agent whose terminal you used last. Pick another one here.")
      : row.border_2().border_color(t.background);
    const option = (a) => {
      const on = a.address === target?.address, word = statusWord(a.status), tab = (a.tab_name ?? "").trim();
      return this.action(h_flex().mx(-4).px(4).h(24).gap(6).items_center().rounded(6).text_size(11)
        .child(this.mark(a, ink))
        .child(div().min_w(0).truncate().text_color(on ? t.foreground : ink.sub).when(on, (e) => e.font_semibold()).child(targetTitle(a)))
        .child(div().flex_1())
        .child(div().flex_none().max_w("45%").truncate().text_color(ink.header).child([tab, word].filter(Boolean).join(" · "))),
      `target-${a.address}`, () => this.pick(a), t,
      { edge: t.background, label: `Send to ${targetName(a)}${tab ? `, tab ${tab}` : ""}${word ? `, ${word}` : ""}${on ? ", chosen" : ""}` });
    };
    return v_flex().gap(2)
      .child(row)
      .when(Boolean(place), (e) => e.child(div().px(2).text_size(11).text_color(ink.warn).whitespace_normal()
        .child(`This agent is in ${place}, not in the tab you see.`)))
      .when(canPick && this.picking, (e) => e.children(list.map(option)));
  }

  // The text as lines: a long note shows its start, and a click shows the rest.
  noteText(n, t, ink) {
    const open = this.expanded.has(n.id), p = open ? { text: n.text, cut: true } : preview(n.text);
    const lines = p.text.split("\n");
    const body = v_flex().min_w(0).gap(1).text_size(13).text_color(n.doneAt ? ink.hint : t.foreground).when(Boolean(n.doneAt), (e) => e.line_through())
      .children(lines.map((line) => (line.trim() ? div().min_w(0).whitespace_normal().child(line) : div().h(6))));
    if (!p.cut) return body.id(`text-${n.id}`);
    // The 2px cursor border sits in the card's padding, so a long note's text lines up with a short one's.
    return this.action(body.m(-2).rounded(4), `text-${n.id}`, () => { if (open) this.expanded.delete(n.id); else this.expanded.add(n.id); }, t,
      { label: open ? "Show less of the note" : "Show the whole note" }).tooltip(open ? "Show less" : "Show the whole note");
  }

  // The circle at a note's left: a ring while the note waits, filled with a check when it is done.
  // A click moves the note between the two lists, so it takes the place of a Done and a Restore button.
  check(n, done, now, t, ink) {
    const mark = done
      ? div().size(15).rounded(8).flex().items_center().justify_center().bg(t.accent)
        .child(svg("mods/workspace-chrome/check.svg").size(10).text_color(readable(t.raised, t.accent, 3)))
      : div().size(15).rounded(8).border(1.5).border_color(ink.sub);
    return this.action(div().size(23).mt(-3).ml(-4).flex().flex_none().items_center().justify_center().rounded(12).child(mark),
      done ? `restore-${n.id}` : `done-${n.id}`,
      (cx) => { this.cur = done ? `done-${n.id}` : `restore-${n.id}`; this.commit(cx, (notes) => setDone(notes, n.id, !done, now)); }, t,
      { role: "check_box", label: done ? "Done. Put the note back in the queue" : "Mark the note done" })
      .tooltip(done ? "Put back in the queue" : "Mark done");
  }

  note(n, target, t, ink) {
    this.group = n.id;
    const now = Date.now(), done = Boolean(n.doneAt), busy = this.sending === n.id;
    const check = this.check(n, done, now, t, ink);
    // With every space's notes in view, a note says which space it is from.
    const from = this.all && n.space ? shared("space.labels")?.[n.space]?.name ?? spaces().find((s) => s.id === n.space)?.name ?? n.spaceName : null;
    const where = target ? targetName(target) : null, fail = done ? null : this.failed.get(n.id);
    const text = n.text ? this.noteText(n, t, ink) : null;
    const files = n.files.length ? this.fileRow(n.files, `file-${n.id}`, t, ink) : null;
    const failure = fail ? h_flex().gap(6).items_start()
      .child(div().flex_1().min_w(0).pt(4).role("alert").text_size(11).text_color(ink.cardFail).whitespace_normal().child(fail))
      .child(this.button("Dismiss", `dismiss-${n.id}`, () => { this.failed.delete(n.id); this.cur = `send-${n.id}`; }, t, ink, { label: "Dismiss the message" }))
      : null;
    const actions = done
      ? [
        this.button("Delete", `delete-${n.id}`, (cx) => this.deleteNotes([n.id], cx), t, ink,
          { label: "Delete the note", tip: n.files.length ? "Deletes the note and its pasted images. Undo shows for a few seconds." : "Undo shows for a few seconds" }),
      ]
      : [
        this.button(busy ? "Sending…" : fail ? "Send again" : "Send", `send-${n.id}`, (cx) => this.send(n, target, cx), t, ink,
          { strong: Boolean(target), off: !target || Boolean(this.sending), label: where ? `Send the note to ${where}` : "Send: no agent chosen",
            tip: where ? `Paste into ${where} and press Enter` : "Choose an agent first, in the line under the field" }),
        this.button("Copy", `copy-${n.id}`, (cx) => this.copy(n, cx), t, ink, { label: "Copy the note", tip: "Copy the text and the files' paths, and mark the note done" }),
        this.button("Edit", `edit-${n.id}`, () => this.startEdit(n), t, ink, { label: "Edit the note" }),
      ];
    return h_flex().id(`note-${n.id}`).role("list_item").items_start().gap(6).px(10).pt(10).pb(6).rounded(8).bg(t.raised)
      .when(this.editing === n.id, (e) => e.border_1().border_color(ink.ring))
      .child(check)
      .child(v_flex().flex_1().min_w(0).gap(6)
        .when(Boolean(text), (e) => e.child(text))
        .when(Boolean(files), (e) => e.child(files))
        .when(Boolean(failure), (e) => e.child(failure))
        .child(h_flex().flex_wrap().mx(-6).items_center()
          .child(div().flex_1().min_w(0).pl(6).truncate().text_size(11).text_color(ink.hint).child(`${done ? `Done ${ago(n.doneAt, now)}` : ago(n.createdAt, now)}${from ? ` · ${from}` : ""}`))
          .children(actions)));
  }

  searchField(t, ink) {
    this.group = "search";
    return h_flex().gap(4).items_center()
      .child(div().id("queue-search").flex_1().min_w(0).h(28).px(8).flex().items_center().rounded(6).border_1()
        .border_color(this.field === "search" ? ink.ring : ink.line).cursor_text().on_mouse_down("left", stop)
        .child(Input.new(this.search).accessibility_label("Search notes").h_full().text_size(12).text_color(t.foreground)))
      .when(Boolean(this.query), (e) => e.child(this.button("Clear", "queue-search-clear", () => { this.search.set_value(""); this.query = ""; this.cur = "queue-add"; }, t, ink,
        { label: "Clear the search", edge: t.background })));
  }

  // The shown space, by the name the spaces list gives it.
  space() {
    const s = this.demo ? null : spaces().find((x) => x.active);
    return s ? { id: s.id, name: shared("space.labels")?.[s.id]?.name ?? s.name } : null;
  }

  // The notes the panel lists: those of the shown space, or all of them.
  mine() { return this.all ? this.notes : inSpace(this.notes, this.here?.id); }

  body(t, ink) {
    const target = this.target(), list = this.demo ? [demoAgent] : agents();
    const searching = Boolean(this.query.trim()), mine = this.mine();
    const shown = filter(mine, this.query), open = waiting(shown), done = finished(shown);
    const none = searching ? "No note matches the search."
      : mine.length ? "The queue is empty. The notes below are done."
        : "No notes yet. Write a prompt now, and send it when an agent is free. Send pastes the note into the agent and presses Enter.";
    this.searchShown = mine.length >= SEARCH_FROM || Boolean(this.query);
    const composer = this.composer(t, ink), where = this.targetLine(target, list, t, ink);
    const search = this.searchShown ? this.searchField(t, ink) : null;
    const waitingList = v_flex().role("list").accessibility_label("Waiting notes").gap(10).children(open.map((n) => this.note(n, target, t, ink)));
    this.group = "done";
    const gone = this.trash?.gone.length ?? 0;
    const undo = gone ? h_flex().pl(2).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().role("status").text_size(11).text_color(ink.header).child(`Deleted ${plural(gone, "note")}`))
      .child(this.button("Undo", "queue-undo", (cx) => this.undo(cx), t, ink, { label: `Put the ${plural(gone, "deleted note")} back`, edge: t.background }))
      : null;
    // Under a search, Clear deletes what the search shows, which is what the heading counts.
    const clear = done.length ? this.button(searching ? "Clear shown" : "Clear done", "clear-done", (cx) => this.deleteNotes(done.map((n) => n.id), cx), t, ink, {
      label: `Delete the ${plural(done.length, "done note")}${searching ? " this search shows" : ""}`,
      tip: `${searching ? "Delete the done notes this search shows" : "Delete every done note"}. Undo shows for a few seconds.`, edge: t.background,
    }) : null;
    const doneList = v_flex().role("list").accessibility_label("Done notes").gap(10).children(done.map((n) => this.note(n, target, t, ink)));
    return v_flex().gap(10)
      .child(composer)
      .child(where)
      .when(Boolean(search), (e) => e.child(search))
      .when(open.length === 0, (e) => e.child(div().px(2).py(4).text_size(12).text_color(ink.header).whitespace_normal().child(none)))
      .when(open.length > 0, (e) => e.child(waitingList))
      .when(Boolean(undo), (e) => e.child(undo))
      .when(done.length > 0, (e) => e
        .child(h_flex().mt(4).pl(2).gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(11).font_semibold().text_color(ink.header).child(`Done · ${done.length}`))
          .child(clear))
        .child(doneList));
  }

  render(cx) {
    const t = theme();
    if (this.viewer) return this.viewerView(t);
    const ink = inks(t);
    this.ink = ink; this.actions = []; this.ids = []; this.groups = [];
    if (!this.demo && this.rev !== undefined && shared(REV) && shared(REV) !== this.rev) { this.rev = shared(REV); this.stale = true; }
    if (this.rev === undefined) this.rev = shared(REV) ?? null;
    this.here = this.space();
    const count = waiting(this.mine()).length;
    const flash = this.flash && Date.now() <= this.flash.until ? this.flash : null;
    const status = flash?.text ?? (this.saving ? "Saving…" : this.sending ? "Sending…" : count ? `${count} waiting` : "");
    const tone = { ok: ink.ok, warn: ink.warn, fail: ink.fail }[flash?.tone] ?? ink.header;
    this.group = "top";
    // Each space has its own queue. The button names the space, and a click shows every space's notes.
    const scope = this.here ? this.button(this.all ? "All spaces" : this.here.name, "queue-scope", () => {
      this.all = !this.all;
      try { localStorage.setItem("scope", this.all ? "all" : "space"); } catch {}
    }, t, ink, {
      label: this.all ? `The notes of every space show. Show only ${this.here.name}` : `The notes of ${this.here.name} show. Show every space`,
      tip: this.all ? `Show only the notes of ${this.here.name}` : "Show the notes of every space", edge: t.background,
    }) : null;
    const body = v_flex().id("queue-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(10)
      .when(Boolean(this.error), (e) => e
        .child(div().px(2).role("alert").text_size(11).text_color(ink.fail).whitespace_normal().child(this.error))
        .child(this.button("Retry", "queue-retry", (cx) => this.reload(cx), t, ink)))
      // A change that is not on disk stays written here until you dismiss it or the next save works.
      .when(Boolean(this.unsaved), (e) => e.child(h_flex().pl(2).gap(6).items_start()
        .child(div().flex_1().min_w(0).pt(4).role("alert").text_size(11).text_color(ink.warn).whitespace_normal().child(this.unsaved))
        .child(this.button("Dismiss", "queue-unsaved", () => { this.unsaved = null; this.cur = "queue-add"; }, t, ink, { label: "Dismiss the message", edge: t.background }))))
      .when(this.ready, (e) => e.child(this.body(t, ink)));
    // The cursor's button is gone (another window changed the list): the cursor stays near where it was.
    const at = this.ids.indexOf(this.cur);
    if (at >= 0) this.at = at;
    else if (this.ids.length) {
      this.cur = this.ids[Math.min(this.at ?? 0, this.ids.length - 1)];
      if (this.handle.is_focused()) cx.spawn(async (cx) => cx.notify());
    }
    return v_flex().id("queue").role("pane").accessibility_label("Queue").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_drop((e, cx) => { this.files = unique([...this.files, ...e.paths]); cx.notify(); })
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Queue"))
        .child(div().flex_1().min_w(0).truncate().role("status").text_size(11).text_color(tone).child(status))
        .when(Boolean(scope), (e) => e.child(scope.max_w("50%").truncate())))
      .child(body)
      // The keys, shown only while the panel has the keyboard: at the bottom, so the list does not move.
      .when(this.handle.is_focused(), (e) => e.child(div().flex_none().px(12).py(5).border_t(1).border_color(t.border).whitespace_normal()
        .text_size(11).text_color(ink.header).child(`↑ ↓ move · J K next note · Enter runs · N writes${this.searchShown ? " · / searches" : ""} · Esc leaves`)));
  }
}
