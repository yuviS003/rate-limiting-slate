import { C, F, M, doc, txt, box, line, node, path, header, caption, check, cross } from "./theme.mjs";

const W = 1200;
const H = 620;

function bullets(x, items) {
  let s = "";
  items.forEach(([ok, label], i) => {
    const y = 362 + i * 44;
    s += ok ? check(x + 11, y - 6, 11) : cross(x + 11, y - 6, 11);
    s += txt(x + 34, y, label, { size: 19, fill: C.text });
  });
  return s;
}

export function build() {
  let b = header(W, "What rate limiting actually buys you", "One misbehaving client should not be able to hurt everyone else");

  // ---- left panel: no limit ----
  b += box(60, 140, 520, 360, { fill: C.panelAlt, stroke: C.bad, sw: 1.5 });
  b += txt(320, 174, "WITHOUT A LIMIT", { size: 15, weight: 700, anchor: "middle", fill: C.bad, spacing: "1.6" });

  b += node(110, 230, 160, 70, "Buggy client", "retry loop");
  b += line(278, 265, 362, 265, { stroke: C.bad, sw: 2.4, marker: "arwBad" });
  b += txt(320, 214, "1,000 req/s", { size: 17, weight: 700, anchor: "middle", fill: C.bad, font: M });
  b += node(370, 230, 160, 70, "API server", "CPU 100%", { stroke: C.bad, color: C.bad, subColor: C.bad });

  b += bullets(110, [
    [false, "Server CPU pinned at 100%"],
    [false, "Every other user sees timeouts"],
    [false, "One client degrades the whole API"],
  ]);

  // ---- right panel: with limiter ----
  b += box(620, 140, 520, 360, { fill: C.panelAlt, stroke: C.good, sw: 1.5 });
  b += txt(880, 174, "WITH A RATE LIMITER", { size: 15, weight: 700, anchor: "middle", fill: C.good, spacing: "1.6" });

  b += node(645, 230, 130, 70, "Buggy client", "retry loop", { titleSize: 17 });
  b += line(778, 265, 801, 265, { stroke: C.bad, sw: 2.4, marker: "arwBad" });
  b += txt(786, 206, "1,000/s", { size: 14, weight: 700, anchor: "middle", fill: C.bad, font: M });

  b += node(805, 230, 150, 70, "Rate limiter", "per user", { stroke: C.info, color: C.info, subColor: C.info, titleSize: 18 });

  b += line(958, 265, 981, 265, { stroke: C.good, sw: 2.4, marker: "arwGood" });
  b += txt(974, 206, "100/s", { size: 14, weight: 700, anchor: "middle", fill: C.good, font: M });
  b += node(985, 230, 130, 70, "API server", "healthy", { stroke: C.good, color: C.good, subColor: C.good, titleSize: 17 });

  b += bullets(645, [
    [true, "Client capped at 100 req/s"],
    [true, "The other 900 get a clean 429"],
    [true, "Everyone else is unaffected"],
  ]);

  b += caption(W, 560, "Rate limiting is not about punishing users. It is about protecting the service for all of them.", C.muted);
  return doc(W, H, b);
}
