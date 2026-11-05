// Space names in the sidebar lists (shared/names.js, copied into the -plus clones).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generated, stampOf, when, branchTail, branchLabel, spaceLabel } from "../shared/names.js";

const now = new Date(2026, 10, 5, 20, 0);

test("a time-stamp name is generated, a real name is not", () => {
  assert.ok(generated("20261105-183951-57367"));
  assert.ok(!generated("herdr-mods"));
  assert.ok(!generated("20261105"));
  assert.ok(!generated(undefined));
});

test("the stamp reads as local time: today a time, another day the date too", () => {
  assert.equal(when(stampOf("20261105-183951-57367"), now), "18:39");
  assert.equal(when(stampOf("cw/Dinfirmaadresse-20261102-131410-49797"), now), "2 Nov 13:14");
  assert.equal(when(stampOf("main"), now), null);
});

test("a branch drops its tool prefix and repo, and a bare stamp says nothing", () => {
  assert.equal(branchTail("cw/Dinfirmaadresse-20261105-183951-57367", "Dinfirmaadresse"), "");
  assert.equal(branchTail("cw/Dinfirmaadresse-fix-login", "Dinfirmaadresse"), "fix-login");
  assert.equal(branchTail("dinfirmaadresse/pricing", "Dinfirmaadresse"), "pricing");
  assert.equal(branchTail("feature/pricing", "Dinfirmaadresse"), "feature/pricing");
  assert.equal(branchTail("swap", "blocktrader"), "swap");
  assert.equal(branchTail("", "x"), "");
  // A repo name with regex characters is taken literally.
  assert.equal(branchTail("cw/a.b-c", "a.b"), "c");
  assert.equal(branchTail("cw/axb-c", "a.b"), "cw/axb-c");
});

test("the status bar names a stamp branch by its time", () => {
  assert.equal(branchLabel("cw/Dinfirmaadresse-20261105-194444-50813", "Dinfirmaadresse", now), "worktree 19:44");
  assert.equal(branchLabel("main", "herdr-mods", now), "main");
  assert.equal(branchLabel("cw/Dinfirmaadresse-fix-login", "Dinfirmaadresse", now), "fix-login");
  assert.equal(branchLabel("", "x", now), "");
});

test("two worktrees of one repo read as the repo and the time each was made", () => {
  const git = (b) => ({ name: "Dinfirmaadresse", branch: b });
  const a = spaceLabel({ name: "20261105-183951-57367" }, git("cw/Dinfirmaadresse-20261105-183951-57367"), now);
  const b = spaceLabel({ name: "20261105-194444-50813" }, git("cw/Dinfirmaadresse-20261105-194444-50813"), now);
  assert.deepEqual([a.name, a.when], ["Dinfirmaadresse", "18:39"]);
  assert.deepEqual([b.name, b.when], ["Dinfirmaadresse", "19:44"]);
  // Before git answers, the stamp in the name still tells them apart.
  assert.deepEqual(spaceLabel({ name: "20261105-183951-57367" }, null, now), { name: "20261105-183951-57367", when: "18:39", generated: true });
  assert.deepEqual(spaceLabel({ name: "swap" }, { name: "blocktrader", branch: "swap" }, now), { name: "swap", when: null, generated: false });
});
