// A lazy file browser for the focused pane's folder, with bounded read-only previews.
// files-plus: the shipped Files mod, plus image previews (local folders only).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { base64 } from "./b64.js";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, appHome, props, openOverlay, closeOverlay } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
// image() only reads below the app home, so a picked image is copied into this cache first.
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "svg"]);
const CACHE = "data/files-plus", KEEP = 30, MAX_BYTES = 50 * 1024 * 1024;
const extension = path => path.includes(".") ? path.split(".").pop().toLowerCase() : "";

// Pixel size of an image, for fitting it to the space it gets; null where it can't be read.
async function imageSize(src) {
  if (window()?.platform !== "macos") return null;
  const r = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src]).catch(() => null);
  const w = Number(r?.stdout.match(/pixelWidth: (\d+)/)?.[1]), h = Number(r?.stdout.match(/pixelHeight: (\d+)/)?.[1]);
  return w > 0 && h > 0 ? { w, h } : null;
}

// The largest size that keeps the image's shape inside the box; at most 4x its pixels.
// Sizes come in screen points, but w()/h() and the margins are scaled by the app zoom.
function fit(size, area, marginW, marginH) {
  if (!area) return null;
  const zoom = Number(settings().zoom) || 1, box = { width: area.width / zoom - marginW, height: area.height / zoom - marginH };
  if (box.width <= 0 || box.height <= 0) return null;
  if (!size) return { w: box.width, h: box.height };
  const scale = Math.min(box.width / size.w, box.height / size.h, 4);
  return { w: Math.floor(size.w * scale), h: Math.floor(size.h * scale) };
}

// Copies the image into the cache under a name from its checksum and size, so a changed file gets a new name.
async function cachedImage(src, ext) {
  const sum = await exec("cksum", [src]);
  if (sum.code !== 0) throw new Error(sum.stderr || "Cannot read this image");
  const [crc, size] = sum.stdout.trim().split(/\s+/);
  if (Number(size) > MAX_BYTES) throw new Error("Image larger than 50 MB · no preview");
  const dir = `${appHome()}/${CACHE}`, name = `${crc}-${size}.${ext}`;
  // Keeps the newest KEEP copies; the one about to be shown is refreshed by cp.
  const r = await exec("sh", ["-c", 'mkdir -p "$1" && cd "$1" && ls -t | tail -n +$3 | xargs rm -f && cp "$2" "$4"', "files-plus", dir, src, String(KEEP + 1), name]);
  if (r.code !== 0) throw new Error(r.stderr || "Cannot copy this image");
  return `${CACHE}/${name}`;
}

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // The path goes in as Base64 (b64.js): -Command would parse it as code.
    const p = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64(path)}'))`;
    const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$p = ${p}; @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress`]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    if (props()?.viewer) return;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  async loadFolder(path, context) {
    const on = this.on, root = this.root;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (key() !== context || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set();
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) await this.loadFolder(path, context);
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (key() !== context) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (key() === context) this.error = String(e); }
          finally { this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.picture = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    if (IMAGES.has(extension(path))) return this.showImage(path, cx);
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || key() !== context) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && key() === context) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  showImage(path, cx) {
    const context = this.context, src = `${this.root}/${path}`;
    if (this.on) { this.fileError = "Image preview works only for folders on this computer"; return; }
    cx.spawn(async cx => {
      try {
        const [picture, size] = await Promise.all([cachedImage(src, extension(path)), imageSize(src)]);
        if (this.file === path && key() === context) { this.picture = picture; this.pictureSize = size; }
      } catch (e) { if (this.file === path && key() === context) this.fileError = e.message || "Cannot preview this image"; }
      finally { cx.notify(); }
    });
  }

  // A large view over the window; Esc, a click on it or beside it closes it.
  expand() {
    openOverlay({ mod: "files-plus", kind: "dialog", width: 0.9, height: 0.9, props: { viewer: { picture: this.picture, size: this.pictureSize, name: this.file } } });
  }

  viewer(t) {
    const v = props().viewer, shown = fit(v.size, this.size, 32, 32);
    return v_flex().id("viewer").size_full().items_center().justify_center().bg(t.canvas).cursor_pointer()
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_click(() => closeOverlay(props().overlay))
      .tooltip(v.name)
      .when(Boolean(shown), el => el.child(image(v.picture).w(shown.w).h(shown.h)));
  }

  openOutside(cx) {
    const src = `${this.root}/${this.file}`, platform = window()?.platform;
    // Not through cmd.exe: a file named "a&b.png" would run "b.png" there. explorer.exe takes the path as one argument.
    const [cmd, args] = platform === "windows" ? ["explorer.exe", [src.replaceAll("/", "\\")]] : platform === "linux" ? ["xdg-open", [src]] : ["open", [src]];
    cx.spawn(async () => { await exec(cmd, args).catch(() => null); });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files-plus/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-plus/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    const t = theme();
    if (props()?.viewer) return this.viewer(t);
    if (key() !== this.context) this.refresh(cx);
    // The picture gets the panel below the 42 px header, less 10 px padding on each side.
    const shown = this.picture && fit(this.pictureSize, this.size, 20, 42 + 20);
    return v_flex().id("files").size_full().on_size_change((size, cx) => { this.size = size; cx.notify(); }).min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(this.picture), el => el
          .child(div().id("files-expand").px(6).rounded(5).cursor_pointer().text_size(12).text_color(t.muted).hover(s => s.bg(t.hover))
            .on_click(() => this.expand()).child("Expand"))
          .child(div().id("files-open").px(6).rounded(5).cursor_pointer().text_size(12).text_color(t.muted).hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.openOutside(cx)).child("Open ↗"))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.picture
        ? v_flex().id("files-picture").flex_1().min_h(0).p(10).items_center().justify_center().bg(t.canvas).cursor_pointer()
          .on_click(() => this.expand())
          .when(Boolean(shown), el => el.child(image(this.picture).w(shown.w).h(shown.h)))
        : this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
