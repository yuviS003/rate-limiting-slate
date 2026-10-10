// Shared visual language for all article diagrams.
export const C = {
  bg: "#0B1220",
  panel: "#141E35",
  panelAlt: "#101829",
  stroke: "#26334F",
  text: "#E8EEF9",
  muted: "#93A4C3",
  dim: "#64748B",
  good: "#34D399",
  bad: "#F87171",
  warn: "#FBBF24",
  info: "#60A5FA",
  purple: "#A78BFA",
};

export const F = "Segoe UI, Arial, Helvetica, sans-serif";
export const M = "Consolas, Menlo, monospace";

/** Escape text for safe embedding in SVG. */
export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function doc(w, h, body, { bg = C.bg } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.muted}"/>
  </marker>
  <marker id="arwBad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.bad}"/>
  </marker>
  <marker id="arwGood" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.good}"/>
  </marker>
  <marker id="arwInfo" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.info}"/>
  </marker>
</defs>
<rect width="${w}" height="${h}" fill="${bg}"/>
${body}
</svg>`;
}

export function txt(x, y, s, o = {}) {
  const {
    size = 18,
    fill = C.text,
    weight = 400,
    anchor = "start",
    font = F,
    opacity = 1,
    spacing = "0",
  } = o;
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${spacing}">${esc(s)}</text>`;
}

export function box(x, y, w, h, o = {}) {
  const {
    fill = C.panel,
    stroke = C.stroke,
    sw = 1.5,
    r = 12,
    dash = null,
    opacity = 1,
  } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

export function line(x1, y1, x2, y2, o = {}) {
  const { stroke = C.stroke, sw = 2, dash = null, marker = null, cap = "round", opacity = 1 } = o;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${cap}" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}${marker ? ` marker-end="url(#${marker})"` : ""}/>`;
}

export function circle(cx, cy, r, o = {}) {
  const { fill = C.info, stroke = "none", sw = 0, opacity = 1 } = o;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"/>`;
}

export function path(d, o = {}) {
  const { fill = "none", stroke = C.stroke, sw = 2, marker = null, dash = null, cap = "round", opacity = 1 } = o;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${cap}" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}${marker ? ` marker-end="url(#${marker})"` : ""}/>`;
}

/** Small rounded pill with centred label. */
export function pill(cx, cy, w, h, label, o = {}) {
  const { fill = C.panel, stroke = C.stroke, color = C.text, size = 16, weight = 600 } = o;
  return (
    box(cx - w / 2, cy - h / 2, w, h, { fill, stroke, r: h / 2 }) +
    txt(cx, cy + size * 0.36, label, { size, fill: color, weight, anchor: "middle" })
  );
}

/** Server / service block with a title and optional status line. */
export function node(x, y, w, h, title, sub, o = {}) {
  const { stroke = C.stroke, fill = C.panel, color = C.text, subColor = C.muted, titleSize = 19 } = o;
  let s = box(x, y, w, h, { fill, stroke });
  if (sub) {
    s += txt(x + w / 2, y + h / 2 - 4, title, { size: titleSize, weight: 700, anchor: "middle", fill: color });
    s += txt(x + w / 2, y + h / 2 + 20, sub, { size: 14, anchor: "middle", fill: subColor, font: M });
  } else {
    s += txt(x + w / 2, y + h / 2 + titleSize * 0.36, title, { size: titleSize, weight: 700, anchor: "middle", fill: color });
  }
  return s;
}

export function check(cx, cy, r = 11, color = C.good) {
  return (
    circle(cx, cy, r, { fill: "none", stroke: color, sw: 2.2 }) +
    path(`M ${cx - r * 0.45} ${cy} L ${cx - r * 0.08} ${cy + r * 0.38} L ${cx + r * 0.5} ${cy - r * 0.4}`, {
      stroke: color,
      sw: 2.6,
    })
  );
}

export function cross(cx, cy, r = 11, color = C.bad) {
  const k = r * 0.44;
  return (
    circle(cx, cy, r, { fill: "none", stroke: color, sw: 2.2 }) +
    path(`M ${cx - k} ${cy - k} L ${cx + k} ${cy + k}`, { stroke: color, sw: 2.6 }) +
    path(`M ${cx + k} ${cy - k} L ${cx - k} ${cy + k}`, { stroke: color, sw: 2.6 })
  );
}

/** Title + subtitle header used on every static diagram. */
export function header(w, title, subtitle) {
  let s = txt(w / 2, 62, title, { size: 40, weight: 700, anchor: "middle", spacing: "-0.6" });
  if (subtitle) s += txt(w / 2, 100, subtitle, { size: 21, anchor: "middle", fill: C.muted });
  return s;
}

/** Footer caption bar. */
export function caption(w, y, text, color = C.warn) {
  return (
    line(80, y - 34, w - 80, y - 34, { stroke: C.stroke, sw: 1 }) +
    txt(w / 2, y, text, { size: 20, anchor: "middle", fill: color, weight: 600 })
  );
}

/** Word-wrapped text block. Returns svg for N lines; width is approximate. */
export function wrap(x, y, s, o = {}) {
  const { size = 16, lh = 22, width = 360, anchor = "start", ...rest } = o;
  const cw = size * 0.515; // rough average glyph width for the UI font
  const max = Math.max(8, Math.floor(width / cw));
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines.map((l, i) => txt(x, y + i * lh, l, { size, anchor, ...rest })).join("");
}
