// Exercise the tab render tree without the native Herdr runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../layout/mods/tabs-plus/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class Tabs", "globalThis.Tabs = class Tabs");

function element() {
  const node = { kids: [], props: {} };
  const el = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child") target.kids.push(args[0]);
        else if (key === "children") target.kids.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](el); }
        else if (key !== "hover") target.props[key] = args;
        return el;
      };
    },
  });
  return el;
}

function renderTab({ name = "tb1", title = "Claude Code", icon = "claude.svg", zoomed = false } = {}) {
  const tab = { id: "one", name, zoomed, active: true };
  const context = vm.createContext({
    View: class {}, div: element, h_flex: element, svg: element, image: element,
    herdrTheme: () => ({}), roles: () => ({}), readable: () => "color",
    spaces: () => [{ id: "space", active: true, tabs: [tab] }],
    panes: () => [{ tab: tab.id, title, program: { name: "Claude Code", icon, agent: true } }],
    layout: () => ({}), window: () => ({}), shared: () => [],
    localStorage: { getItem: () => null },
  });
  vm.runInContext(source, context);
  const view = new context.Tabs();
  view.init();
  return view.render();
}

function find(node, id) {
  if (node?.props?.id?.[0] === id) return node;
  for (const child of node?.kids ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
}
function text(node) {
  return typeof node === "string" ? node : (node.kids ?? []).map(text).join("");
}

test("automatic program labels collapse to an icon with a tooltip", () => {
  for (const name of ["tb1", "1"]) {
    const tab = find(renderTab({ name }), "tab-one");
    assert.equal(text(tab), "");
    assert.equal(tab.props.tooltip[0], "Claude Code");
  }
});

test("typed names stay visible even when they match the program", () => {
  for (const name of ["Claude Code", "Review PR 29"]) {
    assert.equal(text(find(renderTab({ name }), "tab-one")), name);
  }
});

test("task titles, missing icons, and zoom markers stay visible", () => {
  for (const [input, expected] of [
    [{ title: "Review PR 29" }, "Review PR 29"],
    [{ icon: null }, "Claude Code"],
    [{ zoomed: true }, "Z"],
    [{ name: "Claude Code", zoomed: true }, "Claude Code Z"],
  ]) assert.equal(text(find(renderTab(input), "tab-one")), expected);
});

test("new-tab button stays outside the scrolling row and owns its tooltip", () => {
  const root = renderTab();
  const button = find(root, "tab-new"), scroll = find(root, "tab-scroll");
  assert.ok(root.kids.includes(button));
  assert.ok(root.kids.includes(scroll));
  assert.ok(root.kids.indexOf(button) < root.kids.indexOf(scroll));
  assert.equal(find(scroll, "tab-new"), undefined);
  assert.equal(button.props.tooltip[0], "New tab");
  assert.equal(root.props.tooltip, undefined);
});
