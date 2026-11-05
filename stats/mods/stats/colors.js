// Text colors that stay readable in any theme. Themes set `muted` and `dim` for their own taste, and
// some put them below 4.5:1 on `raised`; these helpers lift a color toward the foreground pole just
// enough to reach a contrast floor, and leave it alone when it already does. Pure, so `node --test` loads it.

function parse(hex) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio between two colors, or null when either is not a hex color.
export function contrast(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// `fg` itself when it reaches `min` on `bg`; otherwise the least lift toward white (dark `bg`) or
// black (light `bg`) that does. Colors it cannot read come back unchanged.
export function readable(fg, bg, min) {
  const f = parse(fg), b = parse(bg);
  if (!f || !b || contrast(fg, bg) >= min) return fg;
  const pole = luminance(b) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  const at = (k) => hex(f.map((v, i) => v + (pole[i] - v) * k));
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(at(mid), bg) >= min) hi = mid; else lo = mid;
  }
  return at(hi);
}
