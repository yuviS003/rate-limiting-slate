import { C, F, M, doc, txt, box, line, circle, path, pill } from "./theme.mjs";

const W = 1200;
const H = 675;

export function build() {
  let b = "";

  b += txt(74, 70, "A VISUAL, CODE-FIRST FIELD GUIDE", {
    size: 14, weight: 700, fill: C.good, spacing: "2",
  });
  b += txt(72, 148, "RATE", { size: 72, weight: 800, spacing: "-2" });
  b += txt(72, 222, "LIMITING", { size: 72, weight: 800, spacing: "-2" });
  b += txt(76, 270, "from 15 lines to production", { size: 27, fill: C.muted, weight: 500 });

  b += line(76, 312, 550, 312, { stroke: C.stroke, sw: 1.4 });
  b += txt(76, 352, "Bare JavaScript", { size: 18, weight: 700, fill: C.info });
  b += txt(238, 352, "→", { size: 18, fill: C.dim });
  b += txt(270, 352, "Redis + Lua", { size: 18, weight: 700, fill: C.purple });
  b += txt(410, 352, "→", { size: 18, fill: C.dim });
  b += txt(442, 352, "Postgres", { size: 18, weight: 700, fill: C.warn });

  b += txt(76, 392, "Then beyond requests per second:", { size: 16, fill: C.muted });
  b += pill(152, 433, 150, 36, "CONCURRENCY", { fill: C.panelAlt, stroke: C.purple, color: C.purple, size: 13 });
  b += pill(312, 433, 146, 36, "COST", { fill: C.panelAlt, stroke: C.warn, color: C.warn, size: 13 });
  b += pill(472, 433, 158, 36, "ADAPTIVE", { fill: C.panelAlt, stroke: C.good, color: C.good, size: 13 });

  b += txt(76, 515, "The promise:", { size: 14, fill: C.dim, weight: 700, spacing: "1.2" });
  b += txt(76, 548, "No magic. Every diagram has code.", { size: 21, fill: C.text, weight: 600 });
  b += txt(76, 578, "Every core algorithm was executed.", { size: 21, fill: C.text, weight: 600 });

  // ---- right-hand hero: a bucket, incoming requests, and 429s
  const BX = 735, BY = 190, BW = 270, BH = 300;
  b += path(`M ${BX} ${BY} L ${BX} ${BY + BH - 24} Q ${BX} ${BY + BH} ${BX + 24} ${BY + BH} L ${BX + BW - 24} ${BY + BH} Q ${BX + BW} ${BY + BH} ${BX + BW} ${BY + BH - 24} L ${BX + BW} ${BY}`,
    { stroke: C.info, sw: 4, fill: "#101A2E" });
  b += line(BX, BY, BX + BW, BY, { stroke: C.info, sw: 2, dash: "7 7" });
  b += txt(BX + BW / 2, BY - 10, "10 TOKEN CAPACITY", { size: 13, weight: 700, anchor: "middle", fill: C.info, spacing: "1.3" });

  const pts = [
    [792,434],[866,434],[940,434],
    [792,372],[866,372],[940,372],
    [792,310],[866,310],[940,310],
    [792,248],
  ];
  pts.forEach(([x,y],i) => {
    b += circle(x, y, 21, { fill: i < 7 ? C.good : "none", stroke: i < 7 ? C.good : C.stroke, sw: 2 });
    if (i < 7) b += txt(x, y + 6, "1", { size: 16, anchor: "middle", weight: 700, fill: C.bg, font: M });
  });

  // refill tap
  b += box(844, 108, 52, 22, { fill: C.panel, stroke: C.info, sw: 2, r: 4 });
  b += box(856, 80, 28, 30, { fill: C.panel, stroke: C.info, sw: 2, r: 4 });
  b += circle(870, 153, 7, { fill: C.info });
  b += txt(918, 126, "+2/sec", { size: 17, fill: C.info, weight: 700, font: M });

  // request stream and rejection
  for (let i = 0; i < 6; i++) {
    const x = 650 + i * 30;
    b += circle(x, 552, 8, { fill: i < 3 ? C.info : C.good, opacity: .9 });
  }
  b += path("M 820 552 L 1010 552", { stroke: C.good, sw: 2.6, marker: "arwGood" });
  b += path("M 820 552 Q 900 570 930 626", { stroke: C.bad, sw: 2.4, dash: "5 5", marker: "arwBad" });
  b += pill(1030, 552, 100, 34, "200", { fill: "#10261F", stroke: C.good, color: C.good, size: 15 });
  b += pill(982, 626, 168, 34, "429 · SLOW DOWN", { fill: "#2A1518", stroke: C.bad, color: C.bad, size: 13 });

  b += txt(76, 646, "WITH 15 ORIGINAL VISUALS + A BROWSER LAB", {
    size: 12, weight: 700, fill: C.dim, anchor: "start", spacing: "1.4",
  });

  return doc(W, H, b);
}
