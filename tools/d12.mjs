import { C, F, M, doc, txt, box, line, path, header, caption, wrap } from "./theme.mjs";

const W = 1200;
const H = 780;

const LAYERS = [
  {
    n: "1",
    name: "Edge / CDN",
    accent: C.info,
    catches: "Volumetric floods and scrapers, keyed on IP or fingerprint, before a byte reaches you.",
    state: "The provider's edge",
    cant: "Cannot tell a paying customer from a free one",
  },
  {
    n: "2",
    name: "Request rate limiter",
    accent: C.good,
    catches: "The runaway script. N requests per second per customer, with a bounded burst.",
    state: "Redis, token bucket",
    cant: "Cannot see how long a request takes",
  },
  {
    n: "3",
    name: "Concurrency limiter",
    accent: C.purple,
    catches: "Resource contention on slow, expensive endpoints. Caps requests in flight.",
    state: "Redis or in-process",
    cant: "Cannot price one request against another",
  },
  {
    n: "4",
    name: "Cost / quota accounting",
    accent: C.warn,
    catches: "The expensive query and the monthly bill. Meters units, not calls.",
    state: "Redis + Postgres",
    cant: "Cannot help once the box itself is saturated",
  },
  {
    n: "5",
    name: "Fleet load shedder",
    accent: "#F0A4C0",
    catches: "Reserves a slice of the fleet for critical calls. Sheds the rest with a 503.",
    state: "Redis counters",
    cant: "Decides globally, so one hot box still suffers",
  },
  {
    n: "6",
    name: "Worker load shedder",
    accent: C.bad,
    catches: "Last line of defence. As workers saturate, drops the least critical class first.",
    state: "In-process",
    cant: "Nothing left behind it. This is the floor.",
  },
];

export function build() {
  let b = header(W, "No single limiter is enough",
    "Six layers, each catching what the one above it is blind to");

  const x0 = 86;
  const rowH = 84;
  const gap = 10;
  const y0 = 152;

  // the spine the request travels down
  const spineX = 56;
  const spineBottom = y0 + LAYERS.length * (rowH + gap) - gap;
  b += line(spineX, y0 + 6, spineX, spineBottom - 6, { stroke: C.stroke, sw: 2.4, dash: "6 6", marker: "arw" });
  b += txt(spineX - 8, y0 - 14, "request", { size: 12, fill: C.dim, anchor: "middle" });

  LAYERS.forEach((l, i) => {
    const y = y0 + i * (rowH + gap);
    b += box(x0, y, 1060 - x0 + 70, rowH, { fill: C.panelAlt, stroke: C.stroke, sw: 1.2 });
    b += line(x0, y + 10, x0, y + rowH - 10, { stroke: l.accent, sw: 4 });

    // connector from the spine
    b += line(spineX + 6, y + rowH / 2, x0 - 4, y + rowH / 2, { stroke: C.stroke, sw: 1.4 });

    b += txt(x0 + 22, y + 34, l.n, { size: 15, weight: 700, fill: l.accent, font: M });
    b += wrap(x0 + 44, y + 32, l.name, { size: 18, lh: 21, width: 220, weight: 700, fill: l.accent });

    b += wrap(x0 + 290, y + 28, l.catches, { size: 14, lh: 19, width: 440, fill: C.text });

    b += txt(x0 + 760, y + 30, l.state, { size: 14, weight: 600, fill: C.muted, font: M });
    b += wrap(x0 + 760, y + 52, l.cant, { size: 12, lh: 16, width: 250, fill: C.dim });
  });

  b += txt(x0 + 290, y0 - 12, "WHAT IT CATCHES", { size: 11, weight: 700, fill: C.dim, spacing: "1.4" });
  b += txt(x0 + 760, y0 - 12, "WHERE THE STATE LIVES  ·  ITS BLIND SPOT", {
    size: 11, weight: 700, fill: C.dim, spacing: "1.4",
  });

  b += caption(W, 744,
    "Layers 2 to 6 are roughly the set Stripe describes running in production. Start with layer 2.", C.muted);
  return doc(W, H, b);
}
