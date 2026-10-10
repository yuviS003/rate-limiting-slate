import { C, F, M, doc, txt, box, line, path, header, caption, check, cross, wrap } from "./theme.mjs";

const W = 1200;
const H = 700;

// Costs below are the ones the article's own tests produce.
const REQUESTS = [
  { name: "GET /health", detail: "a status check", cost: 1, color: C.good },
  { name: "GET /search?q=…", detail: "hits the search index", cost: 20, color: C.info },
  { name: "POST /chat", detail: "3,000 LLM tokens", cost: 3_000, color: C.warn },
  { name: "GraphQL, 3 levels deep", detail: "users(100){posts(100){comments(100)}}", cost: 1_010_100, color: C.bad },
];

export function build() {
  let b = header(W, "Four requests. One of them is not like the others.",
    "Every rate limiter so far has assumed a request is a unit of work. Look what that assumes away.");

  // ---- the four requests, with a log-scaled cost bar
  const x = 70;
  const barX = 560;
  const barMax = 500;
  const maxLog = Math.log10(REQUESTS[REQUESTS.length - 1].cost);

  REQUESTS.forEach((r, i) => {
    const y = 170 + i * 74;
    b += box(x, y, 1060, 60, { fill: i % 2 === 0 ? C.panelAlt : "none", stroke: "none", sw: 0, r: 10 });
    b += line(x + 10, y + 10, x + 10, y + 50, { stroke: r.color, sw: 4 });

    b += txt(x + 30, y + 28, r.name, { size: 18, weight: 700, fill: C.text, font: M });
    b += txt(x + 30, y + 48, r.detail, { size: 13, fill: C.muted });

    const w = Math.max(6, (Math.log10(r.cost) / maxLog) * barMax);
    b += box(barX, y + 18, w, 24, { fill: r.color, stroke: "none", sw: 0, r: 6, opacity: 0.85 });
    b += txt(barX + w + 14, y + 36, r.cost.toLocaleString("en-US"), {
      size: 17, weight: 700, fill: r.color, font: M,
    });
  });

  b += txt(barX, 158, "COST  (log scale, or the first three would be invisible)", {
    size: 12, weight: 700, fill: C.dim, spacing: "1.2",
  });

  // ---- the two verdicts
  const vy = 486;
  b += box(70, vy, 520, 112, { fill: C.panelAlt, stroke: C.bad, sw: 1.6 });
  b += txt(94, vy + 32, "COUNTING REQUESTS", { size: 13, weight: 700, fill: C.bad, spacing: "1.4" });
  b += txt(94, vy + 64, "4 of 5 used", { size: 24, weight: 700, fill: C.bad, font: M });
  b += check(300, vy + 57, 11);
  b += txt(320, vy + 63, "under the limit, allowed", { size: 15, fill: C.muted });
  b += txt(94, vy + 92, "The last request was 1,010,100x the first one.", { size: 13, fill: C.muted });

  b += box(610, vy, 520, 112, { fill: C.panelAlt, stroke: C.good, sw: 1.6 });
  b += txt(634, vy + 32, "COUNTING COST", { size: 13, weight: 700, fill: C.good, spacing: "1.4" });
  b += txt(634, vy + 64, "1,013,121 units", { size: 24, weight: 700, fill: C.good, font: M });
  b += cross(866, vy + 57, 11);
  b += txt(886, vy + 63, "rejected, correctly", { size: 15, fill: C.muted });
  b += txt(634, vy + 92, "Shopify, GitHub and OpenAI all meter this way.", { size: 13, fill: C.muted });

  b += caption(W, 668,
    "Price the request before you run it. For LLM calls you cannot, so reserve an estimate and settle the difference after.",
    C.warn);
  return doc(W, H, b);
}
