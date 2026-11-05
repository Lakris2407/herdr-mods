// The shared color file: every mod's copy matches it, and each role reads on its background.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { roles, level, contrast, flatten, readable } from "../shared/colors.js";

const root = new URL("..", import.meta.url).pathname;

test("every mod's colors.js is a copy of shared/colors.js", () => {
  const shared = readFileSync(join(root, "shared/colors.js"), "utf8");
  const copies = readdirSync(root).flatMap((f) => existsSync(join(root, f, "mods")) ? readdirSync(join(root, f, "mods")).map((m) => join(root, f, "mods", m, "colors.js")) : [])
    .filter(existsSync);
  assert.ok(copies.length >= 6);
  for (const c of copies) assert.equal(readFileSync(c, "utf8"), shared, `${c} is stale: run ./sync.sh`);
});

// The theme the critique measured: dim #686970 at 3.14:1 on chrome #1a1b21.
const dark = { foreground: "#d6d6cf", muted: "#95969a", dim: "#686970", border: "#ffffff18", background: "#24252f", chrome: "#1a1b21", popover: "#24252f" };
const light = { foreground: "#1f2328", muted: "#6b7280", dim: "#a0a4ab", border: "#00000014", background: "#ffffff", chrome: "#f3f4f6", popover: "#ffffff" };

test("text roles reach 4.5:1 and edges 3:1, on dark and light", () => {
  for (const [t, bgs] of [[dark, ["#1a1b21", "#24252f"]], [light, ["#ffffff", "#f3f4f6"]]]) {
    for (const bg of bgs) {
      const r = roles(t, bg);
      for (const k of ["sub", "hint", "ok", "warn", "hot", "fail"]) assert.ok(contrast(r[k], bg) >= 4.5, `${k} on ${bg}`);
      for (const k of ["line", "track"]) assert.ok(contrast(r[k], bg) >= 2.99, `${k} on ${bg}`);
    }
  }
});

test("red is only for failures: a capped level stops at hot", () => {
  const r = roles(dark, dark.chrome);
  assert.equal(level(99, r), r.fail);
  assert.equal(level(99, r, { cap: "hot" }), r.hot);
  assert.equal(level(85, r), r.hot);
  assert.equal(level(65, r), r.warn);
  assert.equal(level(10, r), r.ok);
  assert.notEqual(r.hot, r.fail);
  assert.notEqual(r.warn, r.hot);
});

test("a see-through color is read as it shows", () => {
  const fill = flatten("#ffffff18", "#282a36");
  assert.equal(fill, "#3c3e49");
  assert.ok(contrast(readable("#9fa0a5", fill, 4.5), fill) >= 4.5);
  assert.equal(flatten("#282a36", "#000000"), "#282a36");
});
