// The Fleet layout (layout/) must be whole for herdr.dev: every mod it names is in it, ships with
// Herdr or is one the recipe says to add, its copies of this repo's mods match their sources (./bundle-layout.sh), and nothing personal
// rides along.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const layoutDir = join(root, "layout");
const bundled = readdirSync(join(layoutDir, "mods"));
// Mods every Herdr install has (0.1.13), so the layout may name them without bundling them.
const SHIPPED = new Set(["changes", "confirm", "menu", "pane", "files", "agents", "new-menu", "peek", "workspace-chrome", "toast", "worktree"]);
// Mods by other people, added from their own page (RECIPE.md says where): their licenses don't let
// this repo carry a copy. The GitHub panel opens its own issue-agent.
const ADDED = new Set(["github", "issue-agent"]);
const known = (mod) => bundled.includes(mod) || SHIPPED.has(mod) || ADDED.has(mod);

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test("every mod the layout names is bundled or shipped", () => {
  const json = readFileSync(join(layoutDir, "layouts", "fleet.json"), "utf8");
  const layout = JSON.parse(json);
  const named = new Set([...json.matchAll(/"mod":\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
  if (layout.terminal_menu) named.add(layout.terminal_menu);
  for (const mod of named) assert.ok(known(mod), `${mod} is not bundled, shipped or named in RECIPE.md`);
});

test("mods the bundle opens are bundled or shipped", () => {
  for (const file of files(join(layoutDir, "mods")).filter((f) => f.endsWith(".js"))) {
    for (const [, mod] of readFileSync(file, "utf8").matchAll(/openOverlay\(\{\s*mod:\s*"([a-z0-9-]+)"/g)) {
      assert.ok(known(mod), `${file} opens ${mod}, which is missing`);
    }
  }
});

test("the layout's copies of this repo's mods match their sources", () => {
  for (const folder of readdirSync(root)) {
    if (folder === "layout" || !existsSync(join(root, folder, "mods"))) continue;
    for (const mod of readdirSync(join(root, folder, "mods"))) {
      if (!bundled.includes(mod)) continue;
      const src = join(root, folder, "mods", mod);
      // Herdr writes these two into each installed mod; bundle-layout.sh leaves them out too.
      for (const file of files(src).filter((f) => !/\/(gpui-kit\.d\.ts|jsconfig\.json)$/.test(f))) {
        const copy = file.replace(src, join(layoutDir, "mods", mod));
        assert.ok(existsSync(copy), `${copy} is missing: run ./bundle-layout.sh`);
        assert.ok(readFileSync(file).equals(readFileSync(copy)), `${copy} differs from ${file}: run ./bundle-layout.sh`);
      }
    }
  }
  for (const shared of ["colors.js", "names.js"]) {
    const want = readFileSync(join(root, "shared", shared));
    for (const mod of bundled) {
      const copy = join(layoutDir, "mods", mod, shared);
      if (existsSync(copy)) assert.ok(readFileSync(copy).equals(want), `${copy} differs from shared/${shared}: run ./bundle-layout.sh`);
    }
  }
});

test("nothing personal is in the layout", () => {
  const banned = /\/Users\/|\/home\/[a-z]|@[a-z0-9-]+\.(com|eu|dk|io|net)\b|\b\d{1,3}(\.\d{1,3}){3}\b|gh[pousr]_[A-Za-z0-9]{10}|sk-[A-Za-z0-9]{10}/;
  for (const file of files(layoutDir).filter((f) => /\.(js|json|md)$/.test(f))) {
    const hit = readFileSync(file, "utf8").match(banned);
    assert.equal(hit, null, `${file}: ${hit?.[0]}`);
  }
});
