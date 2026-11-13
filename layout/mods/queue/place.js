// Where the panel sits and how large a picture can be: the parts of the panel that measure the window.
import { exec, layout, settings, window } from "herdr";

// Which way Escape leaves the panel: toward the terminals, wherever the layout puts the panel.
export function leaveSide() {
  let path = null;
  const find = (n, up) => {
    if (path || !n) return;
    if (n.content?.mod === "queue") path = [...up, n];
    else for (const c of n.children ?? []) find(c, [...up, n]);
  };
  find(layout(), []);
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

// Pixel size of an image, for fitting it to the window; null where it can't be read.
export async function imageSize(src) {
  if (window()?.platform !== "macos") return null;
  const r = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src]).catch(() => null);
  const w = Number(r?.stdout.match(/pixelWidth: (\d+)/)?.[1]), h = Number(r?.stdout.match(/pixelHeight: (\d+)/)?.[1]);
  return w > 0 && h > 0 ? { w, h } : null;
}

// The largest size that keeps the image's shape inside the box, never above its own pixels' 2x.
// Sizes come in screen points, but w()/h() and the margin are scaled by the app zoom.
export function fit(size, area, margin) {
  if (!area) return null;
  const zoom = Number(settings().zoom) || 1, box = { w: area.width / zoom - margin, h: area.height / zoom - margin };
  if (box.w <= 0 || box.h <= 0) return null;
  if (!size) return box;
  const scale = Math.min(box.w / size.w, box.h / size.h, 2);
  return { w: Math.floor(size.w * scale), h: Math.floor(size.h * scale) };
}
