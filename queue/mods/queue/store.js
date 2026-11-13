// Where the queue lives: ~/.config/herdr-app/queue.json, and pasted images beside it in queue-files/.
import { exec, readTextFile, writeTextFile, appHome } from "herdr";
import * as fs from "fs/promises";
import { parse, serialize } from "./notes.js";

export const notesFile = () => `${appHome()}/queue.json`;
export const filesDir = () => `${appHome()}/queue-files`;

// The notes and the exact text they came from: the next save names that text, so a save never
// replaces a change another window made in between.
export async function load() {
  const text = await readTextFile(notesFile());
  return { text, notes: parse(text) };
}

export async function save(notes, expected) {
  const text = serialize(notes);
  await writeTextFile(notesFile(), text, expected);
  return text;
}

export const removeFile = (path) => fs.unlink(path).catch(() => {});

// image() reads only below the app home, so a dropped image from elsewhere is copied into
// queue-files/view/ to be shown large. One copy at a time: the next one removes the last.
// Returns the path image() takes; the note keeps the original path.
export async function viewCopy(src, id) {
  const dir = `${filesDir()}/view`, ext = src.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "png";
  await fs.mkdir(dir, { recursive: true });
  for (const old of await fs.readdir(dir).catch(() => [])) await removeFile(`${dir}/${old}`);
  await fs.copyFile(src, `${dir}/${id}.${ext}`);
  return `queue-files/view/${id}.${ext}`;
}

// A file that is not an image opens in the app the system picks. macOS only.
export const openFile = (path) => exec("open", [path]);

const script = (lines, args) => exec("osascript", [...lines.flatMap((l) => ["-e", l]), ...args]);

// The clipboard's image as a PNG in queue-files/, or the file a file manager copied, as its own path.
// Null when the clipboard holds neither. macOS only: `osascript` reads the clipboard.
export async function clipboardFile(id) {
  await fs.mkdir(filesDir(), { recursive: true }).catch(() => {});
  const path = `${filesDir()}/${id}.png`;
  const png = await script([
    "on run argv",
    "set png to (the clipboard as «class PNGf»)",
    "set f to open for access POSIX file (item 1 of argv) with write permission",
    "set eof f to 0",
    "write png to f",
    "close access f",
    "end run",
  ], [path]).catch(() => null);
  if (png?.code === 0) return path;
  const copied = await script(["POSIX path of (the clipboard as «class furl»)"], []).catch(() => null);
  // AppleScript also turns plain text into a "path", so only a path that exists counts.
  const file = copied?.code === 0 ? copied.stdout.trim() : "";
  return file.startsWith("/") && await fs.exists(file).catch(() => false) ? file : null;
}
