import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serialize, makeNote, setDone } from "../mods/queue/notes.js";

// Exercise the real panel methods with only the Herdr host boundary replaced. Deferred writes
// let the tests interleave user input, reloads and failures without a running desktop app.
const runtime = "__queuePersistenceTest";
const host = `data:text/javascript,${encodeURIComponent(`
  export class View {}
  export const leaveSide = null, imageSize = null, fit = null;
  export const div = null, image = null, svg = null, h_flex = null, v_flex = null;
  export const TextareaState = null, Textarea = null, InputState = null, Input = null;
  export const theme = null, run = null, hc = null, exec = null, shared = null;
  export const nextCommand = null, layout = null, agents = null, spaces = null, focused = null;
  export const settings = null, window = null, openOverlay = null, closeOverlay = null, props = null;
  export const setShared = (...a) => globalThis.${runtime}.setShared(...a);
  export const load = (...a) => globalThis.${runtime}.load(...a);
  export const save = (...a) => globalThis.${runtime}.save(...a);
  export const removeFile = (...a) => globalThis.${runtime}.removeFile(...a);
  export const clipboardFile = null, viewCopy = null, openFile = null, filesDir = () => "/queue-files";
`)}`;
const main = new URL("../mods/queue/main.js", import.meta.url);
const source = (await readFile(main, "utf8")).replace(/from "([^"]+)"/g, (all, name) => {
  if (["gpui-kit", "gpui-base", "herdr", "./store.js", "./place.js"].includes(name)) return `from ${JSON.stringify(host)}`;
  return name.startsWith(".") ? `from ${JSON.stringify(new URL(name, main).href)}` : all;
});
const { default: Queue } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const note = (id, text, files = []) => makeNote(id, text, files, 1000);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function panel(notes = [], text = "draft", files = []) {
  const storage = new Map([["draft", text]]), deleted = [], writes = [], revisions = [];
  globalThis.localStorage = {
    setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k),
  };
  const q = Object.assign(new Queue(), { notes, files, ready: true, editing: null, failed: new Map(), trash: null, stash: null, fileText: serialize(notes) });
  q.draft = {
    value: () => text, focus() {},
    set_value(value) { text = value; if (!q.editing) storage.set("draft", value); },
  };
  const host = globalThis[runtime] = {
    async save(next, expected) { writes.push({ notes: next, expected }); return serialize(next); },
    async load() { return { notes, text: serialize(notes) }; },
    removeFile(path) { deleted.push(path); }, setShared(key, value) { revisions.push(value); },
  };
  const tasks = [];
  const cx = { notify() {}, spawn(fn) { tasks.push(Promise.resolve(fn(cx))); } };
  return { q, cx, host, storage, deleted, writes, revisions, drain: () => Promise.all(tasks) };
}

test("failed Add preserves the draft and screenshot through the conflict reload", async () => {
  const f = panel([], "  keep this prompt  ", ["/queue-files/draft.png"]);
  f.host.save = async () => { throw new Error("stale snapshot"); };
  f.q.submit(f.cx);
  await f.drain();
  assert.equal(f.q.draft.value(), "  keep this prompt  ");
  assert.equal(f.q.ready, false);
  assert.equal(f.storage.get("draft"), "  keep this prompt  ");
  assert.deepEqual(f.q.files, ["/queue-files/draft.png"]);
  f.q.reload(f.cx);
  await f.drain();
  assert.equal(f.q.ready, true);
  assert.equal(f.q.draft.value(), "  keep this prompt  ");
  assert.deepEqual(f.deleted, []);
});

test("successful Add clears only the saved draft, after the disk write", async () => {
  const f = panel(), disk = deferred();
  f.host.save = () => disk.promise;
  f.q.submit(f.cx);
  assert.equal(f.q.draft.value(), "draft");
  assert.deepEqual(f.q.notes, []);
  disk.resolve("saved");
  await f.drain();
  assert.equal(f.q.notes[0].text, "draft");
  assert.equal(f.q.draft.value(), "");
  assert.equal(f.storage.has("draft"), false);
});

test("typing during a save preserves the newer draft", async () => {
  const f = panel(), disk = deferred();
  f.host.save = () => disk.promise;
  f.q.submit(f.cx);
  f.q.draft.set_value("draft plus more");
  disk.resolve("saved");
  await f.drain();
  assert.equal(f.q.notes[0].text, "draft");
  assert.equal(f.q.draft.value(), "draft plus more");
  assert.equal(f.storage.get("draft"), "draft plus more");
});

test("reloads wait for an in-flight write instead of replacing its snapshot", async () => {
  const n = note("a", "one"), f = panel([n]), disk = deferred();
  f.host.save = () => disk.promise;
  let loads = 0;
  f.host.load = async () => { loads++; return { notes: [], text: null }; };
  const first = f.q.commit(f.cx, (notes) => setDone(notes, "a", true, 2000));
  await Promise.resolve();
  f.q.reload(f.cx);
  assert.equal(loads, 0);
  assert.equal(f.q.stale, true);
  disk.resolve("saved");
  assert.equal(await first, true);
  assert.equal(f.q.notes[0].doneAt, 2000);
});

test("an unreadable reload blocks writes until a successful retry", async () => {
  const f = panel([note("a", "one")]);
  f.host.load = async () => { throw new Error("invalid JSON"); };
  f.q.reload(f.cx);
  await f.drain();
  assert.equal(f.q.ready, false);
  assert.match(f.q.error, /invalid JSON/);
  assert.equal(await f.q.commit(f.cx, () => []), false);
  assert.equal(f.writes.length, 0);
  f.host.load = async () => ({ notes: [], text: null });
  f.q.reload(f.cx);
  await f.drain();
  assert.equal(f.q.ready, true);
  assert.equal(f.q.error, null);
});

test("Cancel restores the unfinished draft and its pasted image", () => {
  const n = note("a", "saved note"), f = panel([n], "unfinished", ["/queue-files/draft.png"]);
  f.q.startEdit(n);
  assert.equal(f.q.draft.value(), "saved note");
  assert.deepEqual(f.deleted, []);
  f.q.cancelEdit();
  assert.equal(f.q.draft.value(), "unfinished");
  assert.equal(f.storage.get("draft"), "unfinished");
  assert.deepEqual(f.q.files, ["/queue-files/draft.png"]);
  assert.deepEqual(f.deleted, []);
});

test("saving an edit restores the earlier draft; failing keeps the edit", async () => {
  const n = note("a", "saved note"), f = panel([n], "unfinished");
  f.q.startEdit(n);
  f.q.draft.set_value("edited note");
  f.host.save = async () => { throw new Error("disk full"); };
  f.q.submit(f.cx);
  await f.drain();
  assert.equal(f.q.editing, "a");
  assert.equal(f.q.draft.value(), "edited note");
  assert.equal(f.storage.get("draft"), "unfinished");
  f.q.reload(f.cx);
  await f.drain();
  f.host.save = async (notes) => serialize(notes);
  f.q.submit(f.cx);
  await f.drain();
  assert.equal(f.q.notes[0].text, "edited note");
  assert.equal(f.q.draft.value(), "unfinished");
  assert.equal(f.q.editing, null);
});

test("pasted images referenced by an in-flight save cannot be removed from disk", async () => {
  const path = "/queue-files/draft.png", f = panel([], "draft", [path]), disk = deferred();
  f.host.save = () => disk.promise;
  f.q.submit(f.cx);
  f.q.files = [];
  f.q.dropComposerFiles([path]);
  assert.deepEqual(f.deleted, []);
  disk.resolve("saved");
  await f.drain();
  assert.deepEqual(f.q.notes[0].files, [path]);
});


test("an edit survives another window deleting its original note", async () => {
  const n = note("a", "saved note"), f = panel([n], "unfinished");
  f.q.startEdit(n);
  f.q.draft.set_value("keep this edit");
  f.host.load = async () => ({ notes: [], text: null });
  f.q.reload(f.cx);
  await f.drain();
  f.q.submit(f.cx);
  await f.drain();
  assert.equal(f.q.notes.length, 1);
  assert.equal(f.q.notes[0].text, "keep this edit");
  assert.notEqual(f.q.notes[0].id, "a");
  assert.equal(f.q.draft.value(), "unfinished");
});

test("Delete retains images for Undo, and only expired Undo releases them", async () => {
  const path = "/queue-files/note.png", n = note("a", "one", [path]), f = panel([n]);
  f.q.deleteNotes(["a"], f.cx);
  await f.drain();
  assert.deepEqual(f.q.notes, []);
  assert.deepEqual(f.deleted, []);
  f.q.undo(f.cx);
  await f.drain();
  assert.deepEqual(f.q.notes, [n]);
  assert.deepEqual(f.deleted, []);
  f.q.deleteNotes(["a"], f.cx);
  await f.drain();
  f.q.emptyTrash();
  assert.deepEqual(f.deleted, [path]);
});
