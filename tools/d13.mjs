import { C, F, M, doc, txt, box, line, path, circle, header, caption } from "./theme.mjs";
import { createVegasLimit } from "../code/phase4-beyond/adaptive.mjs";

const W = 1200;
const H = 700;

// ---------------------------------------------------------------------------
// This chart is not drawn by hand. It is the actual output of
// code/phase4-beyond/adaptive.mjs driven through a latency profile.
// ---------------------------------------------------------------------------
const SAMPLES = 90;
const DEGRADE_FROM = 30;
const DEGRADE_TO = 58;

function run() {
  const v = createVegasLimit({ initial: 20, min: 1, max: 120 });
  const rows = [];
  for (let i = 0; i < SAMPLES; i++) {
    const rttMs = i >= DEGRADE_FROM && i < DEGRADE_TO ? 300 : 100;
    const r = v.onSample({ rttMs, inFlight: v.limit });
    rows.push({ i, rttMs, limit: v.limit, queue: r.queue ?? 0 });
  }
  return rows;
}

const DATA = run();
const MAX_LIMIT = Math.max(...DATA.map((d) => d.limit));
const MAX_RTT = 400;

const PX0 = 120;
const PX1 = 1130;
const px = (i) => PX0 + (i / (SAMPLES - 1)) * (PX1 - PX0);

function chart(y0, h, { label, valueOf, max, color, ticks, unit }) {
  let b = txt(PX0, y0 - 14, label, { size: 13, weight: 700, fill: C.dim, spacing: "1.4" });

  // the degraded window, shaded across both charts
  b += box(px(DEGRADE_FROM), y0, px(DEGRADE_TO) - px(DEGRADE_FROM), h, {
    fill: "#2A1518", stroke: "none", sw: 0, r: 0, opacity: 0.55,
  });

  // gridlines
  for (const t of ticks) {
    const y = y0 + h - (t / max) * h;
    b += line(PX0, y, PX1, y, { stroke: "#1B2740", sw: 1 });
    b += txt(PX0 - 14, y + 5, String(t), { size: 12, anchor: "end", fill: C.dim, font: M });
  }
  b += txt(PX0 - 14, y0 - 4, unit, { size: 11, anchor: "end", fill: C.dim });

  // the series
  const pts = DATA.map((d) => `${px(d.i).toFixed(1)} ${(y0 + h - (valueOf(d) / max) * h).toFixed(1)}`);
  b += path("M " + pts.join(" L "), { stroke: color, sw: 2.6 });

  b += line(PX0, y0 + h, PX1, y0 + h, { stroke: C.dim, sw: 1.6 });
  return b;
}

export function build() {
  let b = header(W, "The limit tunes itself",
    "Latency is the signal. No request had to fail for the limiter to react.");

  const topY = 190;
  const topH = 150;
  const botY = 420;
  const botH = 160;

  b += chart(topY, topH, {
    label: "OBSERVED LATENCY",
    valueOf: (d) => d.rttMs,
    max: MAX_RTT,
    color: C.warn,
    ticks: [100, 200, 300],
    unit: "ms",
  });

  b += chart(botY, botH, {
    label: "CONCURRENCY LIMIT, CHOSEN BY THE ALGORITHM",
    valueOf: (d) => d.limit,
    max: Math.ceil(MAX_LIMIT / 20) * 20,
    color: C.good,
    ticks: [20, 40, 60],
    unit: "in flight",
  });

  // annotate the degraded window once, spanning both charts
  const mid = (px(DEGRADE_FROM) + px(DEGRADE_TO)) / 2;
  b += txt(mid, topY - 36, "downstream slows down", {
    size: 15, weight: 700, anchor: "middle", fill: C.bad,
  });
  b += line(px(DEGRADE_FROM), topY - 24, px(DEGRADE_TO), topY - 24, { stroke: C.bad, sw: 1.6 });

  // callouts with the real numbers
  const peakBefore = Math.max(...DATA.slice(0, DEGRADE_FROM).map((d) => d.limit));
  const troughDuring = Math.min(...DATA.slice(DEGRADE_FROM, DEGRADE_TO).map((d) => d.limit));
  const endAfter = DATA[DATA.length - 1].limit;

  const facts = [
    { x: 150, label: "healthy", value: peakBefore, color: C.good, sub: "limit climbs to find the ceiling" },
    { x: 500, label: "latency 3x", value: troughDuring, color: C.bad, sub: "pulled back before anything broke" },
    { x: 860, label: "recovered", value: endAfter, color: C.good, sub: "climbs again on its own" },
  ];
  b += txt(PX1, 600, "samples over time", { size: 12, fill: C.dim, anchor: "end" });

  for (const f of facts) {
    b += box(f.x, 616, 280, 56, { fill: C.panelAlt, stroke: f.color, sw: 1.4 });
    b += txt(f.x + 18, 640, String(f.value), { size: 24, weight: 700, fill: f.color, font: M });
    b += txt(f.x + 74, 636, f.label, { size: 14, weight: 700, fill: f.color });
    b += txt(f.x + 74, 656, f.sub, { size: 11, fill: C.muted });
  }
  return doc(W, H, b);
}
