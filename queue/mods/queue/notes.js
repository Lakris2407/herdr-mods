// The queue itself: notes with their files, what a note sends, and which agent gets it. Pure (no
// `herdr` imports), so the tests run in plain Node.

export const VERSION = 1;
const IMAGE = /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i;

// The file's text as notes. A missing file is an empty queue; a broken one is an error, so a save
// never replaces notes the panel could not read.
export function parse(text) {
  if (!text || !text.trim()) return [];
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("queue.json is not valid JSON"); }
  const rows = Array.isArray(data) ? data : data?.notes;
  if (!Array.isArray(rows)) throw new Error("queue.json has no notes list");
  return rows.filter((n) => n && typeof n.id === "string" && typeof n.text === "string").map((n) => ({
    id: n.id,
    text: n.text,
    files: Array.isArray(n.files) ? n.files.filter((f) => typeof f === "string") : [],
    createdAt: Number(n.createdAt) || 0,
    doneAt: Number(n.doneAt) || null,
    space: typeof n.space === "string" ? n.space : null,
    spaceName: typeof n.spaceName === "string" ? n.spaceName : null,
  }));
}

export const serialize = (notes) => `${JSON.stringify({ version: VERSION, notes }, null, 2)}\n`;

// A note belongs to the space it was written in (`space`: its id). The name is kept beside it, so
// the note still says where it came from after that space is closed.
export const makeNote = (id, text, files, now, space = null) =>
  ({ id, text: text.trim(), files: unique(files), createdAt: now, doneAt: null, space: space?.id ?? null, spaceName: space?.name ?? null });

// The notes of one space. A note with no space (written before notes had one) shows in every space.
export const inSpace = (notes, id) => (id ? notes.filter((n) => !n.space || n.space === id) : notes);

export const unique = (list) => [...new Set(list)];

// A new note goes on top: it is the one you just wrote.
export const add = (notes, note) => [note, ...notes];

export const edit = (notes, id, text, files) =>
  notes.map((n) => (n.id === id ? { ...n, text: text.trim(), files: unique(files) } : n));

export const setDone = (notes, id, done, now) =>
  notes.map((n) => (n.id === id ? { ...n, doneAt: done ? now : null } : n));

export const remove = (notes, id) => notes.filter((n) => n.id !== id);

export const clearDone = (notes) => notes.filter((n) => !n.doneAt);

// Delete takes notes out together with where they were, so Undo can put each one back in its place.
export const taken = (notes, ids) => notes.map((note, index) => ({ note, index })).filter((g) => ids.includes(g.note.id));

export function removeMany(notes, ids) {
  const gone = new Set(ids);
  return notes.filter((n) => !gone.has(n.id));
}

export function putBack(notes, gone) {
  const out = removeMany(notes, gone.map((g) => g.note.id));
  for (const g of [...gone].sort((a, b) => a.index - b.index)) out.splice(Math.min(g.index, out.length), 0, g.note);
  return out;
}

export const waiting = (notes) => notes.filter((n) => !n.doneAt);

// The note finished last comes first.
export const finished = (notes) => notes.filter((n) => n.doneAt).sort((a, b) => b.doneAt - a.doneAt);

// Every word of the query must be in the note's text or in a file name; case does not count.
export function filter(notes, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return notes;
  return notes.filter((n) => {
    const hay = `${n.text}\n${n.files.map(fileName).join("\n")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// Files `before` held that `after` no longer names: what a delete or an edit may remove from disk.
export function dropped(before, after) {
  const kept = new Set(after.flatMap((n) => n.files));
  return unique(before.flatMap((n) => n.files)).filter((f) => !kept.has(f));
}

// Only a file the panel made itself (a pasted image, in `dir`) is the panel's to delete.
export const owned = (path, dir) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/");

export const fileName = (path) => path.replace(/\/+$/, "").split("/").pop() || path;

export const isImage = (path) => IMAGE.test(path);

// What the agent gets: the text, then each file's path on its own line. An agent reads a path it is
// given, so a screenshot rides along as its path.
export function promptText(note) {
  const text = note.text.trim();
  if (!note.files.length) return text;
  const files = note.files.join("\n");
  return text ? `${text}\n\n${files}` : files;
}

// A long note shows its start: whole lines up to `lines`, and at most `max` characters.
export function preview(text, { lines = 6, max = 420 } = {}) {
  const rows = text.split("\n");
  let out = rows.slice(0, lines).join("\n");
  if (out.length > max) out = out.slice(0, max).trimEnd();
  const cut = out.length < text.length;
  return { text: cut ? `${out.trimEnd()}…` : text, cut };
}

export function ago(at, now) {
  const min = Math.floor((now - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Where Send goes. Only agents take a note: text sent to a shell would run as a command. The agent
// whose terminal had the keyboard last wins; with none, the only agent of the shown tab.
export function pickTarget(agents, last, tab) {
  const byFocus = agents.find((a) => a.address === last);
  if (byFocus) return byFocus;
  const here = agents.filter((a) => a.tab === tab);
  return here.length === 1 ? here[0] : null;
}

// "Claude Code · fix the login test": the program, then the agent's own title when it says more.
export function targetName(agent) {
  const program = agent.program?.name ?? agent.app ?? "Agent";
  const title = (agent.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return title && title !== program ? `${program} · ${title}` : program;
}

// What the row shows beside the program's icon: the agent's own title, else the program.
export function targetTitle(agent) {
  const program = agent.program?.name ?? agent.app ?? "Agent";
  const title = (agent.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return title || program;
}

// What the agent does now, in a word. "done" (finished while you looked away) is free too.
export function statusWord(status) {
  if (status === "working") return "working";
  if (status === "blocked") return "waits for your answer";
  return status === "idle" || status === "done" ? "free" : "";
}

// Where the agent is when it is not in the tab you see: its tab's name, or "" when it is in view.
export function targetPlace(agent, tab) {
  if (agent.tab === tab) return "";
  const name = (agent.tab_name ?? "").trim();
  return name ? `the tab "${name}"` : "another tab";
}

// Why `hc send` failed, as one sentence. hc prints `{ "error": { "message", "kind" } }`.
export function sendError(result) {
  const raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  let message = raw.split("\n")[0] ?? "", kind = "";
  try { const e = JSON.parse(raw).error; message = e?.message ?? message; kind = e?.kind ?? ""; } catch {}
  if (kind === "not_found" || /no terminal/i.test(message)) return "That agent is gone. Click another agent's terminal, then send again.";
  if (/blocked/i.test(message)) return "The agent waits for an answer. Answer it first, then send again.";
  if (result.code === -1 && !message) return "hc is not installed, so the note was not sent.";
  return message ? `Not sent: ${message}` : "The note was not sent.";
}
