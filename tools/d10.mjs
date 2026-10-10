import { C, F, M, doc, txt, box, line, header, caption, check, cross } from "./theme.mjs";

const W = 1200;
const H = 700;

const X0 = 110;
const X1 = 560;      // per-panel timeline width
const SPAN = 10;     // seconds

function panel(px, { label, accent, durationSec, note, verdict, verdictColor }) {
  const t = (s) => px + X0 - 60 + (s / SPAN) * (X1 - X0);
  let b = box(px, 150, 530, 430, { fill: C.panelAlt, stroke: accent, sw: 1.6 });
  b += txt(px + 24, 184, label, { size: 15, weight: 700, fill: accent, spacing: "1.4" });
  b += txt(px + 24, 210, note, { size: 14, fill: C.muted });

  // two requests arrive every second
  const lanes = 10;
  let maxOverlap = 0;
  const bars = [];
  for (let i = 0; i < 20; i++) {
    const start = Math.floor(i / 2) * 1.0;
    bars.push({ start, end: start + durationSec, lane: i % lanes });
  }
  // how many are in flight at the busiest instant
  for (let s = 0; s <= SPAN; s += 0.25) {
    const n = bars.filter((x) => x.start <= s && x.end > s).length;
    maxOverlap = Math.max(maxOverlap, n);
  }

  const topY = 250;
  const laneH = 22;
  for (const bar of bars) {
    const y = topY + bar.lane * laneH;
    const x = t(bar.start);
    const w = Math.max(5, t(Math.min(SPAN, bar.end)) - x);
    b += box(x, y, w, 13, { fill: accent, stroke: "none", sw: 0, r: 6, opacity: 0.8 });
  }

  // axis
  const axisY = topY + lanes * laneH + 6;
  b += line(t(0), axisY, t(SPAN), axisY, { stroke: C.dim, sw: 1.6 });
  for (const s of [0, 2, 4, 6, 8, 10]) {
    b += line(t(s), axisY, t(s), axisY + 6, { stroke: C.dim, sw: 1.4 });
    b += txt(t(s), axisY + 24, `${s}s`, { size: 12, anchor: "middle", fill: C.muted, font: M });
  }

  b += txt(px + 24, 536, `peak in flight: ${maxOverlap}`, {
    size: 20, weight: 700, fill: verdictColor, font: M,
  });
  b += txt(px + 24, 560, verdict, { size: 14, fill: C.muted });
  return b;
}

export function build() {
  let b = header(W, "Two requests per second, two completely different problems",
    "Identical arrival rate. The only thing that changed is how long each request takes.");

  b += panel(40, {
    label: "EACH REQUEST TAKES 50ms",
    accent: C.good,
    durationSec: 0.05,
    note: "A rate limit of 2/sec is plenty here.",
    verdict: "Nothing ever queues. The box is bored.",
    verdictColor: C.good,
  });

  b += panel(630, {
    label: "EACH REQUEST TAKES 6 SECONDS",
    accent: C.bad,
    durationSec: 6,
    note: "Same 2/sec. The rate limiter sees nothing wrong.",
    verdict: "Twelve handlers alive at once, holding twelve connections.",
    verdictColor: C.bad,
  });

  b += caption(W, 652,
    "A rate limit cannot see duration. That is the gap a concurrency limit fills: cap requests in flight, not requests per second.",
    C.warn);
  return doc(W, H, b);
}
