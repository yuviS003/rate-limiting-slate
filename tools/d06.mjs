import { C, F, M, doc, txt, box, line, header, wrap } from "./theme.mjs";

const W = 1200;
const H = 780;

const COLS = [
  { x: 72, w: 200, label: "ALGORITHM" },
  { x: 292, w: 370, label: "HOW IT WORKS" },
  { x: 680, w: 175, label: "BURSTS?" },
  { x: 872, w: 256, label: "REACH FOR IT WHEN" },
];

const ROWS = [
  {
    name: "Fixed window",
    accent: C.info,
    how: "Count requests in a clock-aligned bucket. The counter resets at the top of every window.",
    burst: "Yes — up to 2x at the boundary",
    burstColor: C.bad,
    when: "You want the simplest thing that works and rough limits are fine.",
  },
  {
    name: "Sliding window log",
    accent: C.purple,
    how: "Store a timestamp per request. Count only the ones inside the trailing window.",
    burst: "No — exact",
    burstColor: C.good,
    when: "The limit has to be precise and you can pay for the memory.",
  },
  {
    name: "Token bucket",
    accent: C.good,
    how: "Tokens refill at a steady rate into a capped bucket. Each request spends one.",
    burst: "Yes — capped at bucket size",
    burstColor: C.good,
    when: "Default pick. Real traffic is bursty and that is fine.",
  },
  {
    name: "Leaky bucket",
    accent: C.warn,
    how: "Requests join a queue that drains at a constant rate instead of being rejected.",
    burst: "No — it smooths them",
    burstColor: C.info,
    when: "Downstream load must stay flat and extra latency is acceptable.",
  },
];

export function build() {
  let b = header(W, "Four algorithms, one cheat sheet", "They all cap traffic. What differs is how they treat a burst.");

  // column headings
  for (const c of COLS) {
    b += txt(c.x, 162, c.label, { size: 13, weight: 700, fill: C.dim, spacing: "1.4" });
  }
  b += line(72, 178, 1128, 178, { stroke: C.stroke, sw: 1.4 });

  const rowH = 126;
  ROWS.forEach((r, i) => {
    const y = 194 + i * rowH;
    if (i % 2 === 0) b += box(60, y, 1080, rowH - 12, { fill: C.panelAlt, stroke: "none", sw: 0, r: 10 });
    b += line(72, y + 10, 72, y + rowH - 22, { stroke: r.accent, sw: 4 });

    b += txt(COLS[0].x + 18, y + 48, r.name, { size: 21, weight: 700, fill: r.accent });
    b += wrap(COLS[1].x, y + 42, r.how, { size: 16, lh: 24, width: COLS[1].w, fill: C.text });
    b += wrap(COLS[2].x, y + 42, r.burst, { size: 16, lh: 24, width: COLS[2].w, fill: r.burstColor, weight: 600 });
    b += wrap(COLS[3].x, y + 42, r.when, { size: 15, lh: 23, width: COLS[3].w, fill: C.muted });
  });

  b += line(72, 714, 1128, 714, { stroke: C.stroke, sw: 1 });
  b += txt(W / 2, 750, "Pick token bucket unless you have a reason not to. Then make sure the counter is shared.", {
    size: 20, weight: 600, anchor: "middle", fill: C.warn,
  });
  return doc(W, H, b);
}
