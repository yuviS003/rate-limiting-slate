import { C, F, M, doc, txt, box, line, node, header, caption } from "./theme.mjs";

const W = 1200;
const H = 700;

function side(x0, cx, { label, labelColor, storeMode, verdict, verdictSub, verdictColor }) {
  let b = box(x0, 150, 520, 420, { fill: C.panelAlt, stroke: labelColor, sw: 1.5 });
  b += txt(cx, 184, label, { size: 15, weight: 700, anchor: "middle", fill: labelColor, spacing: "1.6" });

  // load balancer
  b += node(cx - 100, 206, 200, 50, "Load balancer", null, { titleSize: 17 });

  // three app instances
  const xs = [cx - 200, cx - 66, cx + 68];
  for (const bx of xs) {
    b += line(cx, 258, bx + 66, 298, { stroke: C.stroke, sw: 1.6, marker: "arw" });
    b += node(bx, 300, 132, 72, "Node", "instance", { titleSize: 17 });
  }

  if (storeMode === "memory") {
    // one private counter per process
    for (const bx of xs) {
      b += line(bx + 66, 374, bx + 66, 408, { stroke: C.bad, sw: 1.6, marker: "arwBad" });
      b += box(bx, 410, 132, 50, { fill: "#2A1518", stroke: C.bad, sw: 1.4, r: 8 });
      b += txt(bx + 66, 432, "in memory", { size: 13, anchor: "middle", fill: C.bad });
      b += txt(bx + 66, 452, "count: 100", { size: 15, weight: 700, anchor: "middle", fill: C.bad, font: M });
    }
  } else {
    // one shared counter
    xs.forEach((bx, i) => {
      b += line(bx + 66, 374, cx + (i - 1) * 48, 408, { stroke: C.good, sw: 1.6, marker: "arwGood" });
    });
    b += box(cx - 125, 410, 250, 50, { fill: "#10261F", stroke: C.good, sw: 1.6, r: 8 });
    b += txt(cx, 432, "Redis  (shared)", { size: 14, anchor: "middle", fill: C.good, weight: 600 });
    b += txt(cx, 452, "count: 100", { size: 15, weight: 700, anchor: "middle", fill: C.good, font: M });
  }

  b += line(x0 + 40, 492, x0 + 480, 492, { stroke: C.stroke, sw: 1 });
  b += txt(cx, 526, verdict, { size: 24, weight: 700, anchor: "middle", fill: verdictColor });
  b += txt(cx, 552, verdictSub, { size: 15, anchor: "middle", fill: C.muted });
  return b;
}

export function build() {
  let b = header(W, "The bug that only shows up in production", "The limit is 100 requests per minute per user, and the app runs on three instances");

  b += side(60, 320, {
    label: "COUNTER IN PROCESS MEMORY",
    labelColor: C.bad,
    storeMode: "memory",
    verdict: "Real limit: 300 / min",
    verdictSub: "every process counts on its own",
    verdictColor: C.bad,
  });

  b += side(620, 880, {
    label: "COUNTER IN SHARED REDIS",
    labelColor: C.good,
    storeMode: "redis",
    verdict: "Real limit: 100 / min",
    verdictSub: "one counter, all processes agree",
    verdictColor: C.good,
  });

  b += caption(W, 650, "A rate limiter is only as correct as the store behind it. Memory stores silently multiply your limit by the instance count.", C.warn);
  return doc(W, H, b);
}
