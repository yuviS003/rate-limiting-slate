import { C, F, M, doc, txt, box, line, path, header, caption, wrap } from "./theme.mjs";

const W = 1200;
const H = 660;

const ACTS = [
  {
    act: "ACT I",
    title: "The Naked Counter",
    accent: C.info,
    add: "A Map and some arithmetic. No dependencies at all.",
    get: "Real protection for a single process, in about 15 lines.",
    breaks: "You deploy a second pod and every limit silently doubles.",
  },
  {
    act: "ACT II",
    title: "One Shared Brain",
    accent: C.purple,
    add: "Redis, and the whole decision inside one Lua script.",
    get: "One true counter across every instance, and no races.",
    breaks: "Redis restarts and this month's billable usage is gone.",
  },
  {
    act: "ACT III",
    title: "Speed and Truth",
    accent: C.good,
    add: "Postgres for policy and the ledger. Redis stays the hot path.",
    get: "Per-second limits and per-month quotas, both correct.",
    breaks: "A single request turns out to cost a thousand times another.",
  },
  {
    act: "ACT IV",
    title: "Past Requests Per Second",
    accent: C.warn,
    add: "Concurrency caps, cost accounting, adaptive limits, shedding.",
    get: "Limits that track what work actually costs, and tune themselves.",
    breaks: "Nothing yet. This is roughly where the big APIs live.",
  },
];

export function build() {
  let b = header(W, "The road from fifteen lines to production",
    "Each act fixes the thing the previous act broke on");

  const w = 255;
  const gap = 26;
  const x0 = 51;
  const y0 = 148;
  const h = 408;

  ACTS.forEach((a, i) => {
    const x = x0 + i * (w + gap);
    b += box(x, y0, w, h, { fill: C.panelAlt, stroke: a.accent, sw: 1.6 });

    b += txt(x + 18, y0 + 32, a.act, { size: 13, weight: 700, fill: a.accent, spacing: "1.8" });
    b += wrap(x + 18, y0 + 62, a.title, {
      size: 21, lh: 26, width: w - 36, weight: 700, fill: C.text,
    });

    b += line(x + 18, y0 + 122, x + w - 18, y0 + 122, { stroke: C.stroke, sw: 1 });

    b += txt(x + 18, y0 + 150, "YOU ADD", { size: 11, weight: 700, fill: C.dim, spacing: "1.4" });
    b += wrap(x + 18, y0 + 172, a.add, { size: 14, lh: 20, width: w - 36, fill: C.text });

    b += txt(x + 18, y0 + 252, "YOU GET", { size: 11, weight: 700, fill: C.dim, spacing: "1.4" });
    b += wrap(x + 18, y0 + 274, a.get, { size: 14, lh: 20, width: w - 36, fill: a.accent });

    b += txt(x + 18, y0 + 342, "IT BREAKS WHEN", { size: 11, weight: 700, fill: C.dim, spacing: "1.4" });
    b += wrap(x + 18, y0 + 364, a.breaks, { size: 13, lh: 19, width: w - 36, fill: C.muted });

    // the arrow handing off to the next act
    if (i < ACTS.length - 1) {
      const ax = x + w + 4;
      b += path(`M ${ax} ${y0 + h / 2} L ${ax + 17} ${y0 + h / 2}`, {
        stroke: C.dim, sw: 2.2, marker: "arw",
      });
    }
  });

  b += caption(W, 622,
    "You do not need Act IV on day one. You do need to know which act you are currently in.", C.warn);
  return doc(W, H, b);
}
