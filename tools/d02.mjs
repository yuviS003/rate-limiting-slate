import { C, F, M, doc, txt, box, line, path, header, caption, check } from "./theme.mjs";

const W = 1200;
const H = 680;

const AXIS = 420;
const X0 = 120;
const X1 = 1080;
const SEC = (X1 - X0) / 120; // 120 seconds across the axis
const t = (s) => X0 + s * SEC;

// deterministic jitter so the render is stable
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function burst(fromSec, toSec, color) {
  let s = "";
  const n = 16;
  for (let i = 0; i < n; i++) {
    const x = t(fromSec + ((toSec - fromSec) * i) / (n - 1));
    const h = 70 + rnd() * 80;
    s += line(x, AXIS - 2, x, AXIS - h, { stroke: color, sw: 4, cap: "round", opacity: 0.95 });
  }
  return s;
}

export function build() {
  let b = header(W, "Fixed window: the boundary problem", "The limit is 100 requests per minute, and both windows below pass the check");

  // window regions
  b += box(X0, 200, t(60) - X0, AXIS - 200, { fill: "#16233E", stroke: C.info, sw: 1.2, r: 8, dash: "6 5", opacity: 0.9 });
  b += box(t(60), 200, X1 - t(60), AXIS - 200, { fill: "#1D1B38", stroke: C.purple, sw: 1.2, r: 8, dash: "6 5", opacity: 0.9 });

  b += txt(t(30), 182, "WINDOW A   11:59:00 → 12:00:00", { size: 15, weight: 700, anchor: "middle", fill: C.info, spacing: "1.2" });
  b += txt(t(90), 182, "WINDOW B   12:00:00 → 12:01:00", { size: 15, weight: 700, anchor: "middle", fill: C.purple, spacing: "1.2" });

  // the traffic
  b += burst(49, 59, C.info);
  b += burst(61, 71, C.purple);

  // axis
  b += line(110, AXIS, 1090, AXIS, { stroke: C.dim, sw: 2 });
  for (const [s, label] of [[0, "11:59:00"], [30, "11:59:30"], [60, "12:00:00"], [90, "12:00:30"], [120, "12:01:00"]]) {
    b += line(t(s), AXIS, t(s), AXIS + 8, { stroke: C.dim, sw: 2 });
    b += txt(t(s), AXIS + 30, label, { size: 15, anchor: "middle", fill: C.muted, font: M });
  }

  // the boundary
  b += line(t(60), 150, t(60), AXIS + 14, { stroke: C.warn, sw: 2.6, dash: "7 6" });
  b += txt(t(60), 138, "counter resets here", { size: 16, weight: 700, anchor: "middle", fill: C.warn });

  // the damage bracket
  const bx0 = t(49) - 8;
  const bx1 = t(71) + 8;
  b += path(`M ${bx0} ${AXIS + 54} L ${bx0} ${AXIS + 68} L ${bx1} ${AXIS + 68} L ${bx1} ${AXIS + 54}`, { stroke: C.bad, sw: 2.4 });
  b += txt((bx0 + bx1) / 2, AXIS + 96, "200 requests in ~20 seconds  =  2x the limit", { size: 21, weight: 700, anchor: "middle", fill: C.bad });

  // per-window verdicts
  b += box(170, 560, 380, 62, { fill: C.panel, stroke: C.good, sw: 1.4 });
  b += check(206, 591, 12);
  b += txt(232, 584, "Window A: 100 / 100", { size: 18, weight: 700, font: M });
  b += txt(232, 606, "passes the limit check", { size: 14, fill: C.muted });

  b += box(650, 560, 380, 62, { fill: C.panel, stroke: C.good, sw: 1.4 });
  b += check(686, 591, 12);
  b += txt(712, 584, "Window B: 100 / 100", { size: 18, weight: 700, font: M });
  b += txt(712, 606, "passes the limit check", { size: 14, fill: C.muted });

  return doc(W, H, b);
}
