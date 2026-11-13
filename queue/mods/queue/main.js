// A queue of notes and prompts in a side panel: write one now, send it to an agent when the agent is
// free. A note can carry files and pasted screenshots; Send pastes the text and the files' paths into
// the agent's terminal and presses Enter, Copy puts the same text on the clipboard.
// The notes live in ~/.config/herdr-app/queue.json (store.js); notes.js holds the logic and has no Herdr imports.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { theme, run, hc, exec, shared, setShared, nextCommand, layout, agents, focused, settings, window, openOverlay, closeOverlay, props as blockProps } from "herdr";
import { randomUUID } from "crypto";
import { load, save, removeFile, clipboardFile, filesDir } from "./store.js";
import { demoNotes, demoAgent } from "./demo.js";
import {
  makeNote, add, edit, setDone, remove, clearDone, waiting, finished, filter, dropped, owned, unique,
  fileName, isImage, promptText, preview, ago, plural, pickTarget, targetName, sendError,
} from "./notes.js";
import { readable, roles } from "./colors.js";

// Another copy of the panel saved: every copy reads this stamp and loads the file again.
const REV = "queue.rev";
const TICK = 3000, MINUTE = 60000, FLASH = 4000;
// The search field shows once the list is long enough to need it.
const SEARCH_FROM = 6;

// Which way Escape leaves the panel: toward the terminals, wherever the layout puts the panel.
function leaveSide() {
  let path = null;
  const find = (n, up) => {
    if (path || !n) return;
    if (n.content?.mod === "queue") path = [...up, n];
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

// The theme's own colors, lifted only where a theme sets them below a readable contrast on the cards
// (colors.js): labels at 6:1, hints at 4.5:1, the focus ring at 3:1.
function inks(t) {
  const top = roles(t, t.background);
  return {
    label: readable(t.muted, t.raised, 6),
    hint: readable(t.dim, t.raised, 4.5),
    ring: readable(t.accent, t.raised, 3),
    header: top.hint,
    warn: top.warn,
    fail: top.fail,
    ok: top.ok,
  };
}

const stop = (_e, cx) => cx.stop_propagation();

// Pixel size of an image, for fitting it to the window; null where it can't be read.
async function imageSize(src) {
  if (window()?.platform !== "macos") return null;
  const r = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src]).catch(() => null);
  const w = Number(r?.stdout.match(/pixelWidth: (\d+)/)?.[1]), h = Number(r?.stdout.match(/pixelHeight: (\d+)/)?.[1]);
  return w > 0 && h > 0 ? { w, h } : null;
}

// The largest size that keeps the image's shape inside the box, never above its own pixels' 2x.
// Sizes come in screen points, but w()/h() and the margin are scaled by the app zoom.
function fit(size, area, margin) {
  if (!area) return null;
  const zoom = Number(settings().zoom) || 1, box = { w: area.width / zoom - margin, h: area.height / zoom - margin };
  if (box.w <= 0 || box.h <= 0) return null;
  if (!size) return box;
  const scale = Math.min(box.w / size.w, box.h / size.h, 2);
  return { w: Math.floor(size.w * scale), h: Math.floor(size.h * scale) };
}

export default class Queue extends View {
  init(props, cx) {
    // The same mod is the large view of one pasted image (see preview()).
    this.viewer = (props ?? blockProps())?.viewer ?? null;
    if (this.viewer) return;
    // `{ "demo": true }` in the block's props: made-up notes for screenshots; nothing is read, saved or sent.
    this.demo = Boolean((props ?? blockProps())?.demo);
    this.notes = this.demo ? demoNotes() : [];
    this.fileText = null;   // the file as last read or written: what the next save expects to replace
    this.ready = this.demo;
    this.files = [];        // the composer's files
    this.editing = null;    // the id of the note the composer holds
    this.expanded = new Set();
    this.query = "";
    this.at = 0;            // the keyboard cursor over this.actions
    this.handle = cx.focus_handle();

    let draft = "";
    try { draft = this.demo ? "" : localStorage.getItem("draft") ?? ""; } catch {}
    this.draft = TextareaState.new({ value: draft, placeholder: "Add a note, a prompt or a task" });
    this.draft.set_auto_grow(2, 10);
    this.draft.on("change", (_e, cx) => {
      try { if (!this.demo && !this.editing) localStorage.setItem("draft", this.draft.value()); } catch {}
      cx.notify();
    });
    // Enter is a new line; Cmd+Enter (Ctrl+Enter) adds the note.
    this.draft.on("submit", (e, cx) => { if (e.secondary) this.submit(cx); });
    this.draft.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.draft.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // A paste with no text: a screenshot, or a file copied in a file manager.
    this.draft.on("paste_other", (_e, cx) => this.pasteFile(cx));

    this.search = InputState.new({ placeholder: "Search notes" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });

    if (!this.demo) this.reload(cx);
    let minute = Date.now();
    cx.timer.every(TICK, (cx) => {
      if (this.stale) { this.stale = false; this.reload(cx); }
      // "5m ago" stays true, and a status line goes away when its time is up.
      if (Date.now() - minute >= MINUTE || (this.flash && Date.now() > this.flash.until)) {
        if (Date.now() - minute >= MINUTE) minute = Date.now();
        if (this.flash && Date.now() > this.flash.until) this.flash = null;
        cx.notify();
      }
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
    cx.spawn(async (cx) => {
      try {
        const file = await load();
        this.notes = file.notes; this.fileText = file.text; this.ready = true; this.error = null;
      } catch (e) { this.error = `${e.message ?? e}. Fix or remove the file; nothing is saved until then.`; }
      cx.notify();
    });
  }

  say(text, tone = "plain") { this.flash = { text, tone, until: Date.now() + FLASH }; }

  // Every change goes through here: the list changes at once, then the file is written. Saves run
  // one after the other. A pasted image leaves the disk only after the save that dropped its note.
  commit(cx, change) {
    if (!this.ready) return;
    const before = this.notes;
    this.notes = change(before);
    cx.notify();
    if (this.demo) return;
    const gone = dropped(before, this.notes).filter((f) => owned(f, filesDir()) && !this.files.includes(f));
    const earlier = this.saving ?? Promise.resolve();
    this.saving = new Promise((done) => cx.spawn(async (cx) => {
      await earlier;
      try {
        this.fileText = await save(this.notes, this.fileText);
        this.rev = Date.now(); setShared(REV, this.rev);
        for (const f of gone) removeFile(f);
      } catch {
        // The file changed under us (another window), or the disk refused: show what is on disk.
        this.say("That change was not saved: the notes changed somewhere else.", "warn");
        this.stale = true;
      }
      cx.notify(); done();
    }));
  }

  // The composer's Add or Save.
  submit(cx) {
    const text = this.draft.value().trim(), files = this.files;
    if (!text && !files.length) return;
    if (this.editing) {
      const id = this.editing;
      this.resetComposer();
      this.commit(cx, (notes) => edit(notes, id, text, files));
    } else {
      this.resetComposer();
      this.commit(cx, (notes) => add(notes, makeNote(randomUUID(), text, files, Date.now())));
    }
  }

  resetComposer() {
    this.editing = null; this.files = [];
    this.draft.set_value("");
    try { if (!this.demo) localStorage.removeItem("draft"); } catch {}
  }

  startEdit(note) {
    this.dropComposerFiles();
    this.editing = note.id; this.files = [...note.files];
    this.draft.set_value(note.text);
    this.draft.focus();
  }

  cancelEdit() {
    this.dropComposerFiles();
    this.resetComposer();
  }

  // A pasted image that no note holds goes from the disk when the composer lets go of it.
  dropComposerFiles(only = null) {
    if (this.demo) return;
    const held = new Set(this.notes.flatMap((n) => n.files));
    for (const f of only ?? this.files) if (owned(f, filesDir()) && !held.has(f)) removeFile(f);
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

  // Where Send goes now: an agent, or null.
  target() {
    if (this.demo) return demoAgent;
    const f = focused();
    if (f?.terminal) this.last = f.terminal;
    return pickTarget(agents(), this.last, f?.tab ?? null);
  }

  send(note, target, cx) {
    if (!target || this.sending) return;
    if (this.demo) { this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now())); this.say(`Sent to ${target.program.name}`); return; }
    this.sending = note.id;
    cx.notify();
    cx.spawn(async (cx) => {
      // "--" ends hc's options, so a note that starts with a dash is still text.
      const r = await hc(["send", "--json", "--", target.address, promptText(note)]).catch((e) => ({ code: -1, stdout: "", stderr: "" }));
      this.sending = null;
      if (r.code === 0) {
        this.say(`Sent to ${targetName(target)}`, "ok");
        this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now()));
      } else this.say(sendError(r), "fail");
      cx.notify();
    });
  }

  copy(note, cx) {
    cx.write_to_clipboard(promptText(note));
    this.say(note.files.length ? `Copied, with ${plural(note.files.length, "file path")}` : "Copied", "ok");
    if (!note.doneAt) this.commit(cx, (notes) => setDone(notes, note.id, true, Date.now()));
  }

  // Everything you can act on registers here while the panel renders, in reading order, so the
  // keyboard walks the same list the mouse sees. `edge` is the 2px border's color when the cursor is
  // elsewhere: the surface the control sits on.
  action(el, id, act, t, { label, role = "button", edge = t.raised, off = false } = {}) {
    const n = this.actions.push(off ? () => {} : act) - 1, cursor = n === this.at && this.handle.is_focused();
    return el.id(id).role(role).when(Boolean(label), (e) => e.accessibility_label(label))
      .border_2().border_color(cursor ? this.ink.ring : edge).when(cursor, (e) => e.aria_active_descendant())
      .when(!off, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.at = n; if (!off) act(cx); cx.notify(); });
  }

  key(e, cx) {
    // In a text field, Escape gives the keyboard back to the panel; every other key is text.
    if (this.typing) {
      if (e.keystroke === "escape") { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const n = this.actions.length;
    if (e.keystroke === "down" && n) this.at = (this.at + 1) % n;
    else if (e.keystroke === "up" && n) this.at = (this.at + n - 1) % n;
    else if ((e.keystroke === "enter" || e.keystroke === "space") && n) this.actions[this.at]?.(cx);
    else if (e.keystroke === "n") this.draft.focus();
    else if (e.keystroke === "escape") run("pane.go", { direction: leaveSide() });
    else if (e.keystroke === "left" || e.keystroke === "right") run("pane.go", { direction: e.keystroke });
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  button(text, id, act, t, ink, { label = text, tip = null, strong = false, off = false, edge = t.raised } = {}) {
    const el = div().px(6).h(22).flex().flex_none().items_center().rounded(6).text_size(11)
      .text_color(off ? ink.hint : strong ? t.foreground : ink.label)
      .when(strong, (e) => e.bg(t.background).font_semibold());
    return this.action(el, id, act, t, { label, off, edge }).when(Boolean(tip), (e) => e.tooltip(tip)).child(text);
  }

  // A note's files: a pasted image as a thumbnail, any other file as its name. `onRemove` adds the ×
  // the composer needs.
  fileRow(files, key, t, ink, onRemove = null) {
    const x = (i) => div().id(`${key}-x-${i}`).flex_none().px(3).rounded(4).text_color(ink.hint).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
      .role("button").accessibility_label(`Remove ${fileName(files[i])}`)
      .on_click((_e, cx) => onRemove(i, cx)).child("×");
    const dir = filesDir();
    return h_flex().flex_wrap().gap(4).items_center().children(files.map((path, i) => {
      const thumb = !this.demo && isImage(path) && owned(path, dir);
      return h_flex().id(`${key}-${i}`).min_w(0).max_w("100%").h(thumb ? 44 : 22).pl(thumb ? 0 : 6).pr(onRemove ? 2 : 6).gap(4).items_center()
        .rounded(5).overflow_hidden().bg(t.background).text_size(11).text_color(ink.label).tooltip(thumb ? "Click to see it large" : path)
        .when(thumb, (e) => e.child(div().id(`${key}-img-${i}`).flex_none().cursor_pointer().role("button")
          .accessibility_label("Show the image large").on_mouse_down("left", stop)
          .on_click((_e, cx) => this.preview(path, cx)).child(image(`queue-files/${fileName(path)}`).h(44))))
        .when(!thumb, (e) => e.child(div().min_w(0).truncate().child(fileName(path))))
        .when(Boolean(onRemove), (e) => e.child(x(i)));
    }));
  }

  composer(t, ink) {
    const editing = Boolean(this.editing);
    const empty = !this.draft.value().trim() && !this.files.length;
    const hint = this.typing ? "⌘↵ adds · Esc leaves the field" : "Drop files here, or paste a screenshot";
    return v_flex().gap(8).p(10).rounded(8).bg(t.raised)
      .when(editing, (e) => e.child(div().text_size(11).text_color(ink.label).child("Editing a note")))
      .child(div().id("queue-field").w_full().cursor_text().on_mouse_down("left", stop)
        .child(Textarea.new(this.draft).w_full().px(8).py(6).rounded(6).border_1()
          .border_color(this.typing ? ink.ring : t.border).bg(t.background).text_color(t.foreground).text_size(13)))
      .when(this.files.length > 0, (e) => e.child(this.fileRow(this.files, "draft-file", t, ink, (i, cx) => {
        const [gone] = this.files.splice(i, 1);
        if (!this.editing) this.dropComposerFiles([gone]);
        cx.notify();
      })))
      .child(h_flex().gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(ink.hint).child(hint))
        .when(editing, (e) => e.child(this.button("Cancel", "queue-cancel", () => this.cancelEdit(), t, ink)))
        .child(this.button(editing ? "Save" : "Add", "queue-add", (cx) => this.submit(cx), t, ink,
          { strong: !empty, off: empty, label: editing ? "Save the note" : "Add the note", tip: "Cmd+Enter in the field does the same" })));
  }

  // The text as lines: a long note shows its start, and a click shows the rest.
  noteText(n, t, ink) {
    const open = this.expanded.has(n.id), p = open ? { text: n.text, cut: true } : preview(n.text);
    const lines = p.text.split("\n");
    const body = v_flex().id(`text-${n.id}`).min_w(0).gap(1).text_size(13).text_color(n.doneAt ? ink.hint : t.foreground)
      .children(lines.map((line) => (line.trim() ? div().min_w(0).whitespace_normal().child(line) : div().h(6))));
    if (!p.cut) return body;
    return body.cursor_pointer().tooltip(open ? "Show less" : "Show the whole note")
      .on_click((_e, cx) => { if (open) this.expanded.delete(n.id); else this.expanded.add(n.id); cx.notify(); });
  }

  note(n, target, t, ink) {
    const now = Date.now(), done = Boolean(n.doneAt), busy = this.sending === n.id;
    const where = target ? targetName(target) : null;
    const actions = done
      ? [
        this.button("Restore", `restore-${n.id}`, (cx) => this.commit(cx, (notes) => setDone(notes, n.id, false, now)), t, ink,
          { label: "Put the note back in the queue" }),
        this.button("Delete", `delete-${n.id}`, (cx) => this.commit(cx, (notes) => remove(notes, n.id)), t, ink,
          { label: "Delete the note", tip: n.files.length ? "Deletes the note and its pasted images" : null }),
      ]
      : [
        this.button(busy ? "Sending…" : "Send", `send-${n.id}`, (cx) => this.send(n, target, cx), t, ink,
          { strong: Boolean(target), off: !target || Boolean(this.sending), label: where ? `Send the note to ${where}` : "Send: no agent chosen",
            tip: where ? `Paste into ${where} and press Enter` : "Click an agent's terminal first: Send goes to the agent you used last" }),
        this.button("Copy", `copy-${n.id}`, (cx) => this.copy(n, cx), t, ink, { label: "Copy the note", tip: "Copy the text and the files' paths, and mark the note done" }),
        this.button("Edit", `edit-${n.id}`, () => this.startEdit(n), t, ink, { label: "Edit the note" }),
        this.button("Done", `done-${n.id}`, (cx) => this.commit(cx, (notes) => setDone(notes, n.id, true, now)), t, ink, { label: "Mark the note done" }),
      ];
    return v_flex().id(`note-${n.id}`).gap(6).px(10).pt(10).pb(6).rounded(8).bg(t.raised)
      .when(this.editing === n.id, (e) => e.border_1().border_color(ink.ring))
      .when(Boolean(n.text), (e) => e.child(this.noteText(n, t, ink)))
      .when(n.files.length > 0, (e) => e.child(this.fileRow(n.files, `file-${n.id}`, t, ink)))
      .child(h_flex().flex_wrap().mx(-6).items_center()
        .child(div().flex_1().min_w(0).pl(6).truncate().text_size(11).text_color(ink.hint).child(done ? `Done ${ago(n.doneAt, now)}` : ago(n.createdAt, now)))
        .children(actions));
  }

  body(t, ink) {
    const target = this.target();
    const shown = filter(this.notes, this.query), open = waiting(shown), done = finished(shown);
    const where = target
      ? h_flex().px(2).gap(4).text_size(11)
        .child(div().flex_none().text_color(ink.header).child("Send goes to"))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(targetName(target)))
      : div().px(2).text_size(11).text_color(ink.header).whitespace_normal()
        .child("Click an agent's terminal to choose where Send goes.");
    const none = this.query.trim() ? "No note matches the search."
      : this.notes.length ? "The queue is empty. The notes below are done."
        : "Nothing waits here yet. Write a prompt above now, and send it when an agent is free.";
    return v_flex().gap(10)
      .child(this.composer(t, ink))
      .child(where)
      .when(this.notes.length >= SEARCH_FROM || Boolean(this.query), (e) => e.child(
        div().id("queue-search").h(28).px(8).flex().items_center().rounded(6).border_1().border_color(t.border).cursor_text()
          .on_mouse_down("left", stop).child(Input.new(this.search).h_full().text_size(12).text_color(t.foreground))))
      .when(open.length === 0, (e) => e.child(div().px(2).py(4).text_size(12).text_color(ink.header).whitespace_normal().child(none)))
      .children(open.map((n) => this.note(n, target, t, ink)))
      .when(done.length > 0, (e) => e
        .child(h_flex().mt(4).pl(2).gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(11).font_semibold().text_color(ink.header).child(`Done · ${done.length}`))
          .child(this.button("Clear done", "clear-done", (cx) => this.commit(cx, clearDone), t, ink,
            { label: `Delete the ${plural(finished(this.notes).length, "done note")}`, tip: "Delete every done note", edge: t.background })))
        .children(done.map((n) => this.note(n, target, t, ink))));
  }

  render(cx) {
    const t = theme();
    if (this.viewer) return this.viewerView(t);
    const ink = inks(t);
    this.ink = ink; this.actions = [];
    if (!this.demo && this.rev !== undefined && shared(REV) && shared(REV) !== this.rev) { this.rev = shared(REV); this.stale = true; }
    if (this.rev === undefined) this.rev = shared(REV) ?? null;
    const count = waiting(this.notes).length;
    const flash = this.flash && Date.now() <= this.flash.until ? this.flash : null;
    const status = flash?.text ?? (this.sending ? "Sending…" : count ? `${count} waiting` : "");
    const tone = { ok: ink.ok, warn: ink.warn, fail: ink.fail }[flash?.tone] ?? ink.header;
    const body = v_flex().id("queue-body").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(10)
      .when(Boolean(this.error), (e) => e.child(div().px(2).text_size(11).text_color(ink.fail).whitespace_normal().child(this.error)))
      .when(this.ready, (e) => e.child(this.body(t, ink)));
    this.at = Math.min(this.at, Math.max(0, this.actions.length - 1));
    return v_flex().id("queue").role("pane").accessibility_label("Queue").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_drop((e, cx) => { this.files = unique([...this.files, ...e.paths]); cx.notify(); })
      .size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child("Queue"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(tone).child(status)))
      // The keys, shown only while the panel has the keyboard.
      .when(this.handle.is_focused(), (e) => e.child(div().flex_none().px(12).py(4).border_b(1).border_color(t.border).truncate()
        .text_size(10).text_color(ink.header).child("↑ ↓ move · Enter runs · N writes · Esc leaves")))
      .child(body);
  }
}
