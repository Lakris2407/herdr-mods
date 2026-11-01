import { test } from "node:test";
import assert from "node:assert/strict";
import { items, label, toggle } from "../mods/controls/controls.js";

const block = (id, mod, extra = {}) => ({ id, type: "block", content: { mod, ...extra.content }, ...extra.node });
const root = {
  id: "root", type: "column", children: [
    { id: "panel", type: "column", children: [{ id: "panel-body", type: "stack", children: [block("files", "files"), block("runners", "runners")] }] },
    { id: "status", type: "row", children: [
      block("status-main", "workspace-status"),
      block("status-ci", "github", { content: { props: { view: "ci" } } }),
      block("status-runners", "runners", { content: { props: { view: "chip" } }, node: { hidden: true } }),
      block("status-controls", "controls", { content: { props: { view: "button" } } }),
    ] },
  ],
};

test("lists status blocks without itself, and panel buttons", () => {
  const { status, panels } = items(root, ["files"]);
  assert.deepEqual(status, [
    { id: "status-main", label: "Workspace", on: true },
    { id: "status-ci", label: "GitHub CI", on: true },
    { id: "status-runners", label: "Runners", on: false },
  ]);
  assert.deepEqual(panels, [{ id: "files", label: "Files", on: false }, { id: "runners", label: "Runners", on: true }]);
});

test("a layout without a status row or panel stack lists nothing", () => {
  assert.deepEqual(items({ id: "root", children: [block("status", "workspace-status")] }), { status: [], panels: [] });
});

test("unknown mods get a readable name", () => {
  assert.equal(label({ mod: "my-cool_mod" }), "My cool mod");
  assert.equal(label({ mod: "servers", props: { view: "summary" } }), "Servers summary");
});

test("toggle adds and removes once", () => {
  assert.deepEqual(toggle(["a"], "a", false), ["a"]);
  assert.deepEqual(toggle(["a"], "b", false), ["a", "b"]);
  assert.deepEqual(toggle(["a", "b"], "a", true), ["b"]);
});
