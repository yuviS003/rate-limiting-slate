import { C, F, M, doc, txt, box, line, circle, header } from "./theme.mjs";

const W = 1200;
const H = 800;

const TX0 = 215;
const TX1 = 1130;
const SPAN = 12;      // seconds shown
const CLIENTS = 6;    // all of them fail at t = 0
const BUCKET = 0.5;   // upstream concurrency is measured per half second
const px = (s) => TX0 + (s / SPAN) * (TX1 - TX0);

let seed = 20260109;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** Fixed interval retries: every client fires on the same instants, forever. */
function lockstep() {
  return Array.from({ length: CLIENTS }, () =>
    Array.from({ length: 11 }, (_, k) => k + 1)
  );
}

/**
 * Exponential backoff with full jitter, the AWS formulation:
 *   sleep = random(0, min(cap, base * 2^attempt))
 * Drawing the delay uniformly from zero is what decorrelates the clients.
 */
// A rate-limited upstream is asking you to slow down, so the base wait is
// seconds rather than milliseconds. A wide first window is what stops the
// initial retry from arriving as one synchronised burst.
const BASE = 3;
const CAP = 8;
function backoff() {
  const per = [];
  for (let c = 0; c < CLIENTS; c++) {
    const ts = [];
    let t = 0;
    for (let k = 0; k < 8; k++) {
      t += rnd() * Math.min(CAP, BASE * 2 ** k);
      if (t > SPAN) break;
      ts.push(t);
    }
    per.push(ts);
  }
  return per;
}

function panel(y0, { label, verdict, accent, per, note }) {
  let b = box(60, y0, 1080, 305, { fill: C.panelAlt, stroke: accent, sw: 1.5 });
  b += txt(90, y0 + 34, label, { size: 15, weight: 700, fill: accent, spacing: "1.6" });
  b += txt(1110, y0 + 34, verdict, { size: 16, weight: 700, fill: accent, anchor: "end" });

  for (let c = 0; c < CLIENTS; c++) {
    const y = y0 + 66 + c * 20;
    b += txt(198, y + 5, `client ${c + 1}`, { size: 13, anchor: "end", fill: C.muted, font: M });
    b += line(TX0, y, TX1, y, { stroke: "#1E2B47", sw: 1.3, dash: "3 6" });
    for (const t of per[c]) b += circle(px(t), y, 5.5, { fill: accent, opacity: 0.95 });
  }

  // upstream concurrency histogram
  const base = y0 + 268;
  const buckets = new Map();
  for (const ts of per) for (const t of ts) {
    const k = Math.floor(t / BUCKET);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  b += txt(198, base + 5, "upstream load", { size: 13, anchor: "end", fill: C.muted, font: M });
  b += line(TX0, base, TX1, base, { stroke: C.dim, sw: 1.6 });
  let peak = 0;
  for (const [k, n] of buckets) {
    peak = Math.max(peak, n);
    b += line(px(k * BUCKET + BUCKET / 2), base - 1, px(k * BUCKET + BUCKET / 2), base - n * 12, {
      stroke: accent, sw: 13, cap: "butt", opacity: 0.85,
    });
  }
  const total = per.reduce((a, ts) => a + ts.length, 0);
  b += txt(1110, base + 26,
    `${total} retries  ·  ${buckets.size} distinct moments  ·  worst burst ${peak}  ·  ${note}`,
    { size: 14, fill: C.muted, anchor: "end" });
  return b;
}

export function build() {
  let b = header(W, "When you are the one getting 429'd", `${CLIENTS} clients, one upstream failure, twelve seconds of retrying`);

  b += panel(140, {
    label: "RETRY ON A FIXED INTERVAL",
    verdict: "upstream never gets a break",
    accent: C.bad,
    per: lockstep(),
    note: "every client in lockstep",
  });

  b += panel(465, {
    label: "EXPONENTIAL BACKOFF + FULL JITTER",
    verdict: "upstream gets room to recover",
    accent: C.good,
    per: backoff(),
    note: "clients drift apart on their own",
  });

  return doc(W, H, b);
}
