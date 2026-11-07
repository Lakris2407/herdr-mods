// What a space is called in the sidebar lists. The same file in every mod that names spaces
// (spaces-plus, workspace-status-plus, pane-plus; see docs/outside-mods.md): copy it, do not fork it.
// spaces-plus writes each space's name to shared("space.labels"), and the others read it there.
//
// A worktree tool names a space by a time stamp ("20261105-183951-57367") and its branch
// "cw/<repo>-<stamp>". Both say nothing a person can tell apart at a glance. The list shows the
// repo instead, and the time the worktree was made, which is what tells two of them apart.

const STAMP = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-\d+$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A space name that is only a time stamp.
export const generated = (name) => typeof name === "string" && /^\d{8}-\d{6}-\d+$/.test(name);

// The local time in a stamp at the end of `text`, or null.
export function stampOf(text) {
  const m = STAMP.exec(text ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

const two = (n) => String(n).padStart(2, "0");

// "18:39" today, "4 Nov 18:39" on another day.
export function when(date, now = new Date()) {
  if (!date) return null;
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return today ? time : `${date.getDate()} ${MONTHS[date.getMonth()]} ${time}`;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The part of a branch that says more than the repo: "cw/Acme-fix-login" in the repo
// Acme is "fix-login". A branch that is only the repo and a stamp says nothing more ("").
export function branchTail(branch, repo) {
  if (!branch) return "";
  let rest = branch;
  if (repo) {
    const stem = new RegExp(`^(?:[^/]+/)*${escape(repo)}(?:[-_/]|$)`, "i");
    if (stem.test(rest)) rest = rest.replace(stem, "");
  }
  if (/^\d{8}-\d{6}-\d+$/.test(rest)) return "";
  return rest;
}

// The branch as a status bar shows it: "cw/Acme-<stamp>" is "worktree 19:44", the
// tool prefix and repo go, and any other branch stays as it is.
export function branchLabel(branch, repo, now = new Date()) {
  if (!branch) return "";
  const tail = branchTail(branch, repo);
  if (tail) return tail;
  const made = when(stampOf(branch), now);
  return made ? `worktree ${made}` : branch;
}

// A space's name in the lists, and what tells it apart from another of the same repo.
// space: { name }, git: { name: repo, branch } or null.
export function spaceLabel(space, git, now = new Date()) {
  const gen = generated(space?.name);
  const name = gen && git?.name ? git.name : space?.name ?? "";
  const made = gen ? stampOf(git?.branch) ?? stampOf(space.name) : null;
  return { name, when: when(made, now), generated: gen };
}
