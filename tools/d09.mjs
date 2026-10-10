import { C, F, M, doc, txt, box, line, path, node, header, caption, wrap } from "./theme.mjs";

const W = 1200;
const H = 720;

const LANE = 250;

export function build() {
  let b = header(W, "Redis for speed, Postgres for truth",
    "Two limits with two different jobs, and the database stays off the hot path");

  b += txt(70, 164, "THE REQUEST PATH   ·   every single request", {
    size: 13, weight: 700, fill: C.dim, spacing: "1.6",
  });

  // ---- the hot path
  b += node(60, LANE - 38, 128, 76, "Request", "arrives", { titleSize: 17 });

  const gates = [
    { x: 236, w: 176, title: "Policy", sub: "cached plan", color: C.info },
    { x: 448, w: 176, title: "Rate limit", sub: "token bucket", color: C.good },
    { x: 660, w: 176, title: "Quota", sub: "month to date", color: C.purple },
  ];

  // a single "all of this is Redis" bracket above the three gates
  b += box(228, LANE - 86, 616, 32, { fill: "#16233E", stroke: C.stroke, sw: 1.2, r: 8 });
  b += txt(536, LANE - 64, "hot requests: Redis only  ·  cold keys seed from Postgres", {
    size: 13, anchor: "middle", fill: C.muted, weight: 600,
  });

  let prevRight = 188;
  for (const g of gates) {
    b += path(`M ${prevRight + 6} ${LANE} L ${g.x - 8} ${LANE}`, { stroke: C.stroke, sw: 2, marker: "arw" });
    b += node(g.x, LANE - 38, g.w, 76, g.title, g.sub, {
      stroke: g.color, color: g.color, titleSize: 18,
    });
    prevRight = g.x + g.w;
  }

  b += path(`M ${prevRight + 6} ${LANE} L 1016 ${LANE}`, { stroke: C.good, sw: 2, marker: "arwGood" });
  b += node(1020, LANE - 38, 120, 76, "Handler", "does work", {
    stroke: C.good, color: C.good, titleSize: 17,
  });

  // ---- the durable layer
  b += txt(70, 452, "THE DURABLE LAYER", { size: 13, weight: 700, fill: C.dim, spacing: "1.6" });

  const pg = { x: 380, y: 484, w: 440, h: 132 };
  b += box(pg.x, pg.y, pg.w, pg.h, { fill: C.panel, stroke: C.info, sw: 1.8 });
  b += txt(pg.x + pg.w / 2, pg.y + 32, "Postgres", { size: 22, weight: 700, anchor: "middle", fill: C.info });
  const rows = [["plans", "the policy"], ["customers", "who gets what"], ["usage_periods", "the ledger"]];
  rows.forEach(([k, v], i) => {
    const y = pg.y + 64 + i * 24;
    b += txt(pg.x + 26, y, k, { size: 15, fill: C.text, font: M });
    b += txt(pg.x + 206, y, v, { size: 13, fill: C.muted });
  });

  // ---- three arrows between the layers, each in its own vertical corridor
  // 1. plan read, up into the policy gate
  b += path(`M 398 ${pg.y - 6} L 398 ${LANE + 44}`, { stroke: C.info, sw: 1.8, dash: "5 5", marker: "arwInfo" });
  b += txt(410, 352, "plan", { size: 14, weight: 700, fill: C.info });
  b += txt(410, 370, "cached for 60s", { size: 12, fill: C.muted });

  // 2. usage flush, down into the ledger
  b += path(`M 666 ${LANE + 44} L 666 ${pg.y - 6}`, { stroke: C.warn, sw: 1.8, marker: "arw" });
  b += txt(654, 424, "usage, flushed every 5s", { size: 14, weight: 700, fill: C.warn, anchor: "end" });
  b += txt(654, 442, "aggregated per customer", { size: 12, fill: C.muted, anchor: "end" });

  // 3. quota seed, up into the quota gate on a cold key
  b += path(`M 812 ${pg.y - 6} L 812 ${LANE + 44}`, { stroke: C.purple, sw: 1.8, dash: "5 5", marker: "arw" });
  b += txt(824, 352, "quota seed", { size: 14, weight: 700, fill: C.purple });
  b += txt(824, 370, "only on a cold key", { size: 12, fill: C.muted });

  // ---- the two numbers that matter, in the clear space either side
  b += box(70, 500, 272, 96, { fill: C.panelAlt, stroke: C.info, sw: 1.4 });
  b += txt(90, 530, "1 read", { size: 26, weight: 700, fill: C.info, font: M });
  b += wrap(90, 556, "per customer per minute, not one per request", {
    size: 13, lh: 18, width: 236, fill: C.muted,
  });

  b += box(858, 500, 272, 96, { fill: C.panelAlt, stroke: C.warn, sw: 1.4 });
  b += txt(878, 530, "1 write", { size: 26, weight: 700, fill: C.warn, font: M });
  b += wrap(878, 556, "per customer per flush, not one per request", {
    size: 13, lh: 18, width: 236, fill: C.muted,
  });

  b += caption(W, 678,
    "At 1,000 req/s, a usage row per request is 2.6 billion rows a month to store one number.", C.warn);
  return doc(W, H, b);
}
