import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse, serialize, makeNote, add, edit, setDone, remove, clearDone, waiting, finished, filter, inSpace, dropped, owned,
  fileName, isImage, promptText, preview, ago, pickTarget, targetName, targetTitle, sendError,
  taken, removeMany, putBack, statusWord, targetPlace, setPinned, pinnedNotes,
} from "../mods/queue/notes.js";
import { demoNotes } from "../mods/queue/demo.js";

const note = (id, text, files = [], doneAt = null) => ({ id, text, files, createdAt: 1000, doneAt, space: null, spaceName: null });

test("a missing or empty file is an empty queue; a broken one is an error", () => {
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse("  \n"), []);
  assert.throws(() => parse("{ nope"), /not valid JSON/);
  assert.throws(() => parse('{"version":1}'), /no notes list/);
});

test("notes survive a save and a load; rows that are not notes are left out", () => {
  const notes = [note("a", "one", ["/x/a.png"]), note("b", "two", [], 2000)];
  assert.deepEqual(parse(serialize(notes)), notes);
  assert.deepEqual(parse(JSON.stringify({ notes: [{ id: 1, text: "x" }, null, { id: "c", text: "ok", files: "no" }] })),
    [{ id: "c", text: "ok", files: [], createdAt: 0, doneAt: null, space: null, spaceName: null }]);
});

test("a new note goes on top, trimmed, with each file once", () => {
  const n = makeNote("n", "  hello \n", ["/a", "/a", "/b"], 5);
  assert.deepEqual(n, { id: "n", text: "hello", files: ["/a", "/b"], createdAt: 5, doneAt: null, space: null, spaceName: null });
  assert.deepEqual(add([note("a", "old")], n).map((x) => x.id), ["n", "a"]);
});

test("a note belongs to its space; a note with no space shows in every space", () => {
  const here = makeNote("h", "here", [], 1, { id: "sp1", name: "shop" });
  const there = makeNote("t", "there", [], 2, { id: "sp2", name: "blog" });
  const old = makeNote("o", "old", [], 3);
  assert.deepEqual([here.space, here.spaceName], ["sp1", "shop"]);
  assert.deepEqual(parse(serialize([here])), [here]);
  assert.deepEqual(inSpace([here, there, old], "sp1").map((n) => n.id), ["h", "o"]);
  assert.deepEqual(inSpace([here, there, old], null).map((n) => n.id), ["h", "t", "o"]);
  // An edit keeps the note in its space.
  assert.equal(edit([here], "h", "new", [])[0].space, "sp1");
});

test("edit, done, restore, delete and clear touch only their note", () => {
  const notes = [note("a", "one"), note("b", "two"), note("c", "three", [], 50)];
  assert.equal(edit(notes, "b", " new ", ["/f"])[1].text, "new");
  assert.deepEqual(edit(notes, "b", "new", ["/f"])[0], notes[0]);
  assert.equal(setDone(notes, "a", true, 99)[0].doneAt, 99);
  assert.equal(setDone(notes, "c", false, 99)[2].doneAt, null);
  assert.deepEqual(remove(notes, "b").map((n) => n.id), ["a", "c"]);
  assert.deepEqual(clearDone(notes).map((n) => n.id), ["a", "b"]);
});

test("waiting keeps its order; done lists the note finished last first", () => {
  const notes = [note("a", "1"), note("b", "2", [], 10), note("c", "3"), note("d", "4", [], 30)];
  assert.deepEqual(waiting(notes).map((n) => n.id), ["a", "c"]);
  assert.deepEqual(finished(notes).map((n) => n.id), ["d", "b"]);
});

test("search needs every word, in the text or a file name, in any case", () => {
  const notes = [note("a", "Fix the Checkout total", ["/tmp/cart.png"]), note("b", "checkout docs")];
  assert.deepEqual(filter(notes, "checkout FIX").map((n) => n.id), ["a"]);
  assert.deepEqual(filter(notes, "cart").map((n) => n.id), ["a"]);
  assert.equal(filter(notes, "  ").length, 2);
});

test("only files no note holds any more are dropped, and only pasted images are the panel's", () => {
  const before = [note("a", "x", ["/q/1.png", "/home/me/doc.md"]), note("b", "y", ["/q/1.png", "/q/2.png"])];
  assert.deepEqual(dropped(before, remove(before, "b")), ["/q/2.png"]);
  assert.deepEqual(dropped(before, []), ["/q/1.png", "/home/me/doc.md", "/q/2.png"]);
  assert.equal(owned("/q/1.png", "/q"), true);
  assert.equal(owned("/home/me/doc.md", "/q"), false);
  assert.equal(owned("/q/sub/1.png", "/q"), false);
  assert.equal(owned("/qq/1.png", "/q"), false);
});

test("what is sent: the text, then each file's path on its own line", () => {
  assert.equal(promptText(note("a", "Fix it")), "Fix it");
  assert.equal(promptText(note("a", "Fix it", ["/a.png", "/b c.md"])), "Fix it\n\n/a.png\n/b c.md");
  assert.equal(promptText(note("a", "", ["/a.png"])), "/a.png");
});

test("a long note shows its start", () => {
  assert.deepEqual(preview("short"), { text: "short", cut: false });
  const many = Array.from({ length: 9 }, (_, i) => `line ${i}`).join("\n");
  const p = preview(many, { lines: 3 });
  assert.equal(p.text, "line 0\nline 1\nline 2…");
  assert.equal(p.cut, true);
  assert.equal(preview("x".repeat(50), { max: 10 }).text, `${"x".repeat(10)}…`);
});

test("file names, images and ages read plainly", () => {
  assert.equal(fileName("/a/b/shot.PNG"), "shot.PNG");
  assert.equal(fileName("/a/folder/"), "folder");
  assert.equal(isImage("/a/shot.PNG"), true);
  assert.equal(isImage("/a/notes.md"), false);
  const now = 10 * 86400000;
  assert.equal(ago(now - 20000, now), "just now");
  assert.equal(ago(now - 5 * 60000, now), "5m ago");
  assert.equal(ago(now - 3 * 3600000, now), "3h ago");
  assert.equal(ago(now - 50 * 3600000, now), "2d ago");
});

test("Send goes to the agent used last, else the only agent of the shown tab, never a guess", () => {
  const agents = [{ address: "t1", tab: "x" }, { address: "t2", tab: "y" }, { address: "t3", tab: "y" }];
  assert.equal(pickTarget(agents, "t3", "x").address, "t3");
  assert.equal(pickTarget(agents, "t9", "x").address, "t1"); // the last terminal was a shell, or is gone
  assert.equal(pickTarget(agents, null, "y"), null);         // two agents: do not pick one
  assert.equal(pickTarget([], "t1", "x"), null);
});

test("the target is named by its program and its own title", () => {
  assert.equal(targetName({ program: { name: "Claude Code" }, title: "✳ Fix the login test" }), "Claude Code · Fix the login test");
  assert.equal(targetName({ program: { name: "Codex" }, title: "Codex" }), "Codex");
  // Beside the program's icon the row shows the title alone, else the program.
  assert.equal(targetTitle({ program: { name: "Claude Code" }, title: "✳ Fix the login test" }), "Fix the login test");
  assert.equal(targetTitle({ program: { name: "Codex" }, title: "" }), "Codex");
  assert.equal(targetName({ app: "pi", title: "" }), "pi");
});

test("the target line says what the agent does, and where it is when it is out of view", () => {
  assert.equal(statusWord("idle"), "free");
  assert.equal(statusWord("done"), "free");
  assert.equal(statusWord("working"), "working");
  assert.equal(statusWord("blocked"), "waits for your answer");
  assert.equal(statusWord(undefined), "");
  assert.equal(targetPlace({ tab: "x", tab_name: "api" }, "x"), "");
  assert.equal(targetPlace({ tab: "y", tab_name: " api " }, "x"), 'the tab "api"');
  assert.equal(targetPlace({ tab: "y" }, "x"), "another tab");
});

test("Undo puts deleted notes back where they were", () => {
  const notes = [note("a", "1"), note("b", "2", [], 10), note("c", "3"), note("d", "4", [], 30)];
  const gone = taken(notes, ["b", "d"]);
  const left = removeMany(notes, ["b", "d"]);
  assert.deepEqual(left.map((n) => n.id), ["a", "c"]);
  assert.deepEqual(putBack(left, gone), notes);
  // A note added in between stays on top, and nothing comes back twice.
  assert.deepEqual(putBack([note("n", "new"), ...left], gone).map((n) => n.id), ["n", "b", "a", "d", "c"]);
  assert.deepEqual(putBack(notes, gone), notes);
  assert.deepEqual(putBack([], gone).map((n) => n.id), ["b", "d"]);
});

test("a failed send says what to do", () => {
  const gone = { code: 1, stdout: '{"error":{"kind":"not_found","message":"no terminal \\"t9\\""}}', stderr: "" };
  assert.match(sendError(gone), /agent is gone/);
  assert.match(sendError({ code: 1, stdout: "", stderr: '{"error":{"kind":"refused","message":"t3 is blocked"}}' }), /waits for an answer/);
  assert.match(sendError({ code: -1, stdout: "", stderr: "" }), /hc is not installed/);
  assert.equal(sendError({ code: 1, stdout: "", stderr: "timed out" }), "Not sent: timed out");
});

test("the demo has waiting and done notes, and every one parses", () => {
  const notes = demoNotes(1e12);
  assert.ok(waiting(notes).length >= 3 && finished(notes).length >= 1 && pinnedNotes(notes).length >= 1);
  assert.deepEqual(parse(serialize(notes)), notes);
});

test("a pinned prompt is never waiting or done, shows in every space, and unpins back into the queue", () => {
  const here = makeNote("h", "here", [], 1, { id: "sp1", name: "shop" });
  const there = { ...makeNote("t", "review the diff", [], 2, { id: "sp2", name: "blog" }), doneAt: 5 };
  let notes = setPinned([here, there], "t", true);
  assert.deepEqual(pinnedNotes(notes).map((n) => n.id), ["t"]);
  assert.equal(notes[1].doneAt, null);
  assert.deepEqual(waiting(notes).map((n) => n.id), ["h"]);
  assert.deepEqual(finished(notes), []);
  assert.deepEqual(inSpace(notes, "sp1").map((n) => n.id), ["h", "t"]);
  assert.deepEqual(parse(serialize(notes)), notes);
  // An edit keeps the pin.
  assert.equal(edit(notes, "t", "new", [])[1].pinned, true);
  notes = setPinned(notes, "t", false);
  assert.equal("pinned" in notes[1], false);
  assert.deepEqual(waiting(notes).map((n) => n.id), ["h", "t"]);
  assert.deepEqual(inSpace(notes, "sp1").map((n) => n.id), ["h"]);
});
