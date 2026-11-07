// What the Controls menu can turn off, read from the shown layout: the blocks of the status row, the
// mod buttons beside the tabs and the buttons of the side-panel stack. Pure, so the tests run it
// without Herdr.

// Names for the mods of this repo and Herdr's own; any other mod shows its mod.json-style name.
const NAMES = {
  "workspace-status": "Workspace", github: "GitHub", system: "System load", quota: "Agent quota",
  runners: "Runners", stats: "Stats", skillshare: "Skills", files: "Files", changes: "Changes", "path-menu": "Path menu",
};

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function label(content) {
  const mod = content?.mod ?? "", view = content?.props?.view;
  const name = NAMES[mod] ?? mod.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return view && view !== "chip" ? `${name} ${view.length <= 3 ? view.toUpperCase() : view}` : name;
}

// Every mod block in the status row except Controls itself (it must stay to open the menu), every mod
// block beside the tabs (such as the Skills toggle) except the tab bar, and every child of the
// side-panel stack. `hidden` is the layout's live state; `buttons` the hidden panel buttons.
// A tab-row button may own a panel column with the id `<mod>-panel`: `panel` names it, so the menu can
// close it with its button.
export function items(root, buttons = []) {
  const status = (find(root, "status")?.children ?? [])
    .filter((n) => n.content?.mod && n.content.mod !== "controls")
    .map((n) => ({ id: n.id, label: label(n.content), on: !n.hidden }));
  const tabs = (find(root, "tabs-row")?.children ?? [])
    .filter((n) => n.content?.mod && n.id !== "tabs")
    .map((n) => {
      const panel = find(root, `${n.content.mod}-panel`);
      return { id: n.id, label: label(n.content), on: !n.hidden, ...(panel ? { panel: panel.id } : {}) };
    });
  const panels = (find(root, "panel-body")?.children ?? [])
    .map((n) => ({ id: n.id, label: label(n.content ?? { mod: n.id }), on: !buttons.includes(n.id) }));
  return { status, tabs, panels };
}

export const toggle = (list, id, on) => (on ? list.filter((x) => x !== id) : [...new Set([...list, id])]);
