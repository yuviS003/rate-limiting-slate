import sharp from "sharp";
import gifencPkg from "gifenc";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { C, F, M, doc, txt, box, line, circle, path, node } from "./theme.mjs";

const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const W = 980;
const H = 552;
const DT = 0.1;
const T = 9.0;
const FRAMES = Math.round(T / DT);

// geometry
const PODA_Y = 170;
const PODB_Y = 296;
const POD_X = 70;
const POD_W = 180;
const POD_H = 78;
const RDS_X = 660;
const RDS_Y = 168;
const RDS_W = 240;
const RDS_H = 170;
const LANE_A = PODA_Y + POD_H / 2;
const LANE_B = PODB_Y + POD_H / 2;
const SEND_X = POD_X + POD_W;
const RECV_X = RDS_X;

const ease = (p) => p * p * (3 - 2 * p);

/**
 * Storyboard. Each message travels between a pod and Redis.
 * `dir` 1 = pod -> redis, -1 = redis -> pod.
 */
const PART2 = 4.6;

const MSGS = [
  // ---- part 1: three round trips, and the gap in the middle
  { t: 0.35, dur: 0.45, lane: "A", dir: 1, label: "GET count", color: C.info },
  { t: 0.85, dur: 0.45, lane: "A", dir: -1, label: "99", color: C.muted },
  { t: 1.15, dur: 0.45, lane: "B", dir: 1, label: "GET count", color: C.info },
  { t: 1.65, dur: 0.45, lane: "B", dir: -1, label: "99", color: C.muted },
  { t: 2.60, dur: 0.45, lane: "A", dir: 1, label: "SET 100", color: C.bad },
  { t: 3.00, dur: 0.45, lane: "B", dir: 1, label: "SET 100", color: C.bad },

  // ---- part 2: one atomic script
  { t: PART2 + 0.35, dur: 0.45, lane: "A", dir: 1, label: "EVAL script", color: C.good },
  { t: PART2 + 0.95, dur: 0.45, lane: "A", dir: -1, label: "allow", color: C.good },
  { t: PART2 + 1.45, dur: 0.45, lane: "B", dir: 1, label: "EVAL script", color: C.good },
  { t: PART2 + 2.05, dur: 0.45, lane: "B", dir: -1, label: "429", color: C.bad },
];

/** Verdict badges that appear next to each pod. */
const VERDICTS = [
  { t: 2.05, until: 4.45, lane: "A", label: "99 < 100  allow", color: C.good },
  { t: 2.35, until: 4.45, lane: "B", label: "99 < 100  allow", color: C.good },
  { t: PART2 + 1.40, until: 8.9, lane: "A", label: "allowed", color: C.good },
  { t: PART2 + 2.50, until: 8.9, lane: "B", label: "rejected", color: C.bad },
];

/** The counter value Redis holds at time t. */
function counterAt(t) {
  if (t < PART2) {
    if (t < 3.05) return 99;
    return 100; // both SETs wrote the same value
  }
  if (t < PART2 + 0.8) return 99;
  return 100;
}

/** Is Redis mid-script (locked) right now? */
function scriptWindow(t) {
  if (t >= PART2 + 0.8 && t < PART2 + 1.0) return "A";
  if (t >= PART2 + 1.9 && t < PART2 + 2.1) return "B";
  return null;
}

function frame(t) {
  const part1 = t < PART2;
  let b = "";

  b += txt(W / 2, 44, "Why the check and the write must be one step", {
    size: 29, weight: 700, anchor: "middle", spacing: "-0.3",
  });

  if (part1) {
    b += txt(W / 2, 76, "Three round trips  ·  GET, decide in Node, SET", {
      size: 17, anchor: "middle", fill: C.bad, weight: 600, font: M,
    });
  } else {
    b += txt(W / 2, 76, "One atomic script  ·  EVAL", {
      size: 17, anchor: "middle", fill: C.good, weight: 600, font: M,
    });
  }

  b += txt(W / 2, 104, "Limit: 1 more request allowed  (count 99, cap 100)", {
    size: 15, anchor: "middle", fill: C.dim,
  });

  // ---- pods
  b += node(POD_X, PODA_Y, POD_W, POD_H, "Pod A", "one request", { titleSize: 19 });
  b += node(POD_X, PODB_Y, POD_W, POD_H, "Pod B", "one request", { titleSize: 19 });

  // ---- redis
  const locked = scriptWindow(t);
  const rdsStroke = locked ? C.good : C.stroke;
  b += box(RDS_X, RDS_Y, RDS_W, RDS_H, { fill: C.panel, stroke: rdsStroke, sw: locked ? 2.6 : 1.5 });
  b += txt(RDS_X + RDS_W / 2, RDS_Y + 34, "Redis", { size: 21, weight: 700, anchor: "middle" });
  b += txt(RDS_X + RDS_W / 2, RDS_Y + 56, "shared counter", { size: 13, anchor: "middle", fill: C.muted });

  const count = counterAt(t);
  const countColor = count >= 100 ? C.warn : C.good;
  b += txt(RDS_X + RDS_W / 2, RDS_Y + 116, String(count), {
    size: 52, weight: 700, anchor: "middle", fill: countColor, font: M,
  });
  b += txt(RDS_X + RDS_W / 2, RDS_Y + 146, "of 100", { size: 14, anchor: "middle", fill: C.dim });

  if (locked) {
    b += txt(RDS_X + RDS_W / 2, RDS_Y - 14, `running script for Pod ${locked}`, {
      size: 14, anchor: "middle", fill: C.good, weight: 700,
    });
    b += txt(RDS_X + RDS_W / 2, RDS_Y + RDS_H + 24, "nothing else can interleave", {
      size: 13, anchor: "middle", fill: C.good,
    });
  }

  // ---- lanes
  for (const y of [LANE_A, LANE_B]) {
    b += line(SEND_X + 6, y, RECV_X - 6, y, { stroke: "#1C2942", sw: 1.4, dash: "3 7" });
  }

  // ---- the dangerous gap in part 1, then what the writes do about it
  if (part1 && t >= 0.85 && t < 4.45) {
    const gx0 = 292;
    const gx1 = 608;
    const writing = t >= 2.6;
    b += box(gx0, LANE_A + 20, gx1 - gx0, LANE_B - LANE_A - 40, {
      fill: "#2A1518", stroke: C.bad, sw: 1.4, r: 8, dash: "5 5", opacity: 0.85,
    });
    const l1 = writing ? "both write 100" : "both pods read 99";
    const l2 = writing ? "the second overwrites the first" : "neither has written yet";
    b += txt((gx0 + gx1) / 2, (LANE_A + LANE_B) / 2 - 4, l1, {
      size: 16, weight: 700, anchor: "middle", fill: C.bad,
    });
    b += txt((gx0 + gx1) / 2, (LANE_A + LANE_B) / 2 + 18, l2, {
      size: 14, anchor: "middle", fill: C.bad, opacity: 0.85,
    });
  }

  // ---- messages in flight
  for (const m of MSGS) {
    const dt = t - m.t;
    if (dt < 0 || dt > m.dur) continue;
    const p = ease(dt / m.dur);
    const y = m.lane === "A" ? LANE_A : LANE_B;
    const x = m.dir === 1
      ? SEND_X + (RECV_X - SEND_X) * p
      : RECV_X - (RECV_X - SEND_X) * p;
    b += circle(x, y, 8, { fill: m.color });
    b += txt(x, y - 18, m.label, { size: 13, anchor: "middle", fill: m.color, weight: 600, font: M });
  }

  // ---- verdict badges
  for (const v of VERDICTS) {
    if (t < v.t || t > v.until) continue;
    const y = v.lane === "A" ? PODA_Y : PODB_Y;
    b += box(POD_X + 6, y + POD_H + 8, 168, 28, {
      fill: v.color === C.good ? "#10261F" : "#2A1518", stroke: v.color, sw: 1.5, r: 14,
    });
    b += txt(POD_X + 90, y + POD_H + 27, v.label, {
      size: 13, weight: 700, anchor: "middle", fill: v.color, font: M,
    });
  }

  // ---- the scoreboard
  if (part1 && t >= 3.5) {
    b += box(60, 446, 860, 62, { fill: "#2A1518", stroke: C.bad, sw: 1.8 });
    b += txt(490, 472, "2 requests served against a limit of 1", {
      size: 20, weight: 700, anchor: "middle", fill: C.bad,
    });
    b += txt(490, 494, "and the counter reads 100, so nothing in your metrics will ever show it", {
      size: 14, anchor: "middle", fill: C.bad, opacity: 0.85,
    });
  } else if (!part1 && t >= PART2 + 2.6) {
    b += box(60, 446, 860, 62, { fill: "#10261F", stroke: C.good, sw: 1.8 });
    b += txt(490, 472, "1 served, 1 rejected, counter reads 100", {
      size: 20, weight: 700, anchor: "middle", fill: C.good,
    });
    b += txt(490, 494, "the read, the decision and the write happened with nothing in between", {
      size: 14, anchor: "middle", fill: C.good, opacity: 0.85,
    });
  }

  return doc(W, H, b);
}

// ---------------------------------------------------------------- encode
const OUT = resolve("../images");
mkdirSync(OUT, { recursive: true });

console.log(`rendering ${FRAMES} frames...`);
const raws = [];
for (let f = 0; f < FRAMES; f++) {
  const svg = frame(+(f * DT).toFixed(4));
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  raws.push(data);
}

const stride = 11;
const per = Math.floor((W * H) / stride);
const sample = new Uint8Array(raws.length * per * 4);
let o = 0;
for (const r of raws) {
  for (let p = 0; p < per; p++) {
    const q = p * stride * 4;
    sample[o++] = r[q]; sample[o++] = r[q + 1]; sample[o++] = r[q + 2]; sample[o++] = 255;
  }
}
const palette = quantize(sample, 128, { format: "rgb565" });

const gif = GIFEncoder();
for (const raw of raws) {
  gif.writeFrame(applyPalette(raw, palette, "rgb565"), W, H, { palette, delay: DT * 1000, repeat: 0 });
}
gif.finish();
const bytes = gif.bytes();
writeFileSync(resolve(OUT, "07-race-condition.gif"), bytes);
console.log(`07-race-condition.gif  ${W}x${H}  ${FRAMES} frames  ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);

const still = frame(3.8);
writeFileSync(resolve(OUT, "07-race-condition.svg"), still);
await sharp(Buffer.from(still), { density: 108 }).png({ compressionLevel: 9 }).toFile(resolve(OUT, "07-race-condition.png"));
console.log("07-race-condition.png written");
