// Keyboard pieces with no app calls, so `node --test` loads them.

// The keyboard cursor follows an item, not a place: jobs come and go between renders, so it keeps
// the id it is on. When that item leaves, it takes whatever now sits where it was.
export function step(ids, cur, last, delta) {
  const n = ids.length;
  if (!n) return { cur: null, last: 0 };
  let at = ids.indexOf(cur);
  if (at < 0) at = Math.min(last, n - 1);
  else at = (at + delta + n) % n;
  return { cur: ids[at], last: at };
}

// Which item the cursor is on: its own id while that is listed, else the one now at its old place.
export function current(ids, cur, last) {
  return ids.includes(cur) ? cur : ids[Math.min(last, ids.length - 1)] ?? null;
}

// Which way Escape leaves a panel: toward the terminals, wherever the layout puts it.
// `mod` names the block; a block with `props.view` is another view of the same mod (the chip).
export function leaveSide(root, mod) {
  let path = null;
  const find = (n, up) => {
    if (path || !n) return;
    if (n.content?.mod === mod && !n.content.props?.view) path = [...up, n];
    else for (const c of n.children ?? []) find(c, [...up, n]);
  };
  find(root, []);
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
