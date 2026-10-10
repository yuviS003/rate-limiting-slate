import sharp from "sharp";
import gifencPkg from "gifenc";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { C, F, M, doc, txt, box, line, circle, path, node } from "./theme.mjs";

const { GIFEncoder, quantize, applyPalette } = gifencPkg;

const W = 980;
const H = 560;
const DT = 0.1;
const T = 6.4; // total loop length in seconds
const FRAMES = Math.round(T / DT);

const CAP = 10;
const REFILL = 2; // tokens per second

// ---------------------------------------------------------------- simulation
// A dense burst drains the bucket, the next requests get 429s, then the
// bucket refills back to full so the animation loops seamlessly.
const requestTimes = [];
for (let i = 0; i < 20; i++) requestTimes.push(+(0.5 + i * 0.1).toFixed(2));

function simulate() {
  let tokens = CAP;
  let last = 0;
  const reqs = [];
  const tokenAt = []; // tokens sampled at every frame

  let ri = 0;
  for (let f = 0; f <= FRAMES; f++) {
    const t = +(f * DT).toFixed(4);
    // refill since last step
    tokens = Math.min(CAP, tokens + (t - last) * REFILL);
    last = t;
    // process any requests landing in this frame
    while (ri < requestTimes.length && requestTimes[ri] <= t + 1e-9) {
      const rt = requestTimes[ri];
      let allowed = false;
      if (tokens >= 1) {
        tokens -= 1;
        allowed = true;
      }
      reqs.push({ t: rt, allowed });
      ri++;
    }
    tokenAt.push(tokens);
  }
  return { reqs, tokenAt };
}

const { reqs, tokenAt } = simulate();

// ---------------------------------------------------------------- geometry
const BX = 330, BY = 130, BW = 170, BH = 215; // bucket box
const BCX = BX + BW / 2;
const LANE = 455;                             // request lane y
const CLIENT_X = 180;                         // lane start
const API_X = 830;                            // lane end
const SLOT_COLS = [BCX - 40, BCX + 40];
const SLOT_ROWS = [320, 282, 244, 206, 168];

function slot(i) {
  const row = Math.floor(i / 2);
  const col = i % 2;
  return [SLOT_COLS[col], SLOT_ROWS[row]];
}

const ease = (p) => p * p * (3 - 2 * p);

// ---------------------------------------------------------------- one frame
function frame(t, tokens) {
  let b = "";

  b += txt(W / 2, 46, "Token bucket, in motion", { size: 32, weight: 700, anchor: "middle", spacing: "-0.4" });
  b += txt(W / 2, 78, "Tokens drip in at a fixed rate. Each request spends one. No token, no service.", {
    size: 16, anchor: "middle", fill: C.muted,
  });

  // ---- tap + drip
  b += box(BCX - 9, 86, 18, 20, { fill: C.panel, stroke: C.info, sw: 1.5, r: 3 });
  b += box(BCX - 17, 104, 34, 11, { fill: C.panel, stroke: C.info, sw: 1.5, r: 3 });
  b += txt(BCX + 40, 108, `refill  ${REFILL} tokens / sec`, { size: 15, fill: C.info, weight: 600, font: M });
  for (const k of [0, 0.5]) {
    const ph = ((t / 0.5) + k) % 1;
    if (ph < 0.92) b += circle(BCX, 120 + ph * 22, 4.5, { fill: C.info, opacity: 0.9 - ph * 0.3 });
  }

  // ---- bucket shell (open top)
  b += path(`M ${BX} ${BY} L ${BX} ${BY + BH - 16} Q ${BX} ${BY + BH} ${BX + 16} ${BY + BH} L ${BX + BW - 16} ${BY + BH} Q ${BX + BW} ${BY + BH} ${BX + BW} ${BY + BH - 16} L ${BX + BW} ${BY}`,
    { stroke: C.stroke, sw: 3, fill: "#101829" });
  b += line(BX, BY, BX + BW, BY, { stroke: C.dim, sw: 1.4, dash: "5 5" });
  b += txt(BX - 14, BY + 6, `capacity ${CAP}`, { size: 14, fill: C.dim, anchor: "end", font: M });

  // ---- tokens
  const whole = Math.floor(tokens + 1e-9);
  const frac = tokens - whole;
  for (let i = 0; i < CAP; i++) {
    const [cx, cy] = slot(i);
    if (i < whole) {
      b += circle(cx, cy, 15, { fill: C.good, opacity: 0.95 });
      b += circle(cx, cy, 15, { fill: "none", stroke: "#0B1220", sw: 1.2 });
    } else if (i === whole && frac > 0.04) {
      b += circle(cx, cy, 15, { fill: C.good, opacity: 0.1 + frac * 0.3 });
      b += circle(cx, cy, 15, { fill: "none", stroke: C.good, sw: 1.5, opacity: 0.55 });
    } else {
      b += circle(cx, cy, 15, { fill: "none", stroke: "#223150", sw: 1.4 });
    }
  }

  // ---- readout
  const low = tokens < 1;
  b += txt(BX + BW + 40, 212, tokens.toFixed(1), {
    size: 46, weight: 700, fill: low ? C.bad : C.good, font: M,
  });
  b += txt(BX + BW + 40, 240, `of ${CAP} tokens available`, { size: 15, fill: C.muted });
  if (tokens >= CAP - 0.01) {
    b += txt(BX + BW + 40, 272, "full — extra tokens overflow", { size: 14, fill: C.warn, weight: 600 });
  } else if (low) {
    b += txt(BX + BW + 40, 272, "empty — requests get 429", { size: 14, fill: C.bad, weight: 600 });
  }

  // ---- lane
  b += node(50, LANE - 36, 130, 72, "Client", "sends requests", { titleSize: 19 });
  b += node(850, LANE - 36, 130, 72, "API", "does the work", { titleSize: 19, stroke: C.good, color: C.good });
  b += line(CLIENT_X, LANE, API_X, LANE, { stroke: "#1E2B47", sw: 2, dash: "4 7" });

  // spend arrow from bucket down into the lane
  b += line(BCX, BY + BH + 10, BCX, LANE - 26, { stroke: C.warn, sw: 2, dash: "5 5", marker: "arw" });
  b += txt(BCX - 14, BY + BH + 48, "spend 1", { size: 14, fill: C.warn, weight: 600, font: M, anchor: "end" });

  // the reject exit is always drawn, so it reads as part of the structure
  b += path(`M ${BCX} ${LANE} Q ${BCX + 120} ${LANE + 4} ${BCX + 185} ${LANE + 62}`,
    { stroke: C.bad, sw: 1.8, dash: "5 6", opacity: 0.5 });
  b += txt(BCX + 196, LANE + 72, "429 Too Many Requests", { size: 14, fill: C.bad, weight: 700, font: M });

  // ---- requests in flight
  let verdict = null;
  for (const r of reqs) {
    const dIn = r.t - t;      // >0 means still approaching
    const dOut = t - r.t;     // >0 means already decided
    if (dIn > 0 && dIn <= 0.45) {
      const p = ease(1 - dIn / 0.45);
      b += circle(CLIENT_X + (BCX - CLIENT_X) * p, LANE, 9, { fill: C.info });
    } else if (dOut >= 0 && dOut <= 0.45) {
      const p = ease(dOut / 0.45);
      if (r.allowed) {
        b += circle(BCX + (API_X - BCX) * p, LANE, 9, { fill: C.good });
      } else {
        b += circle(BCX + 185 * p, LANE + 62 * p * p, 9, { fill: C.bad, opacity: 1 - p * 0.55 });
      }
      if (dOut <= 0.3) verdict = r.allowed;
    }
  }

  // ---- verdict badge
  if (verdict !== null) {
    const ok = verdict === true;
    const label = ok ? "200  allowed" : "429  blocked";
    const col = ok ? C.good : C.bad;
    b += box(705, 372, 190, 40, { fill: ok ? "#10261F" : "#2A1518", stroke: col, sw: 1.8, r: 20 });
    b += txt(800, 399, label, { size: 17, weight: 700, anchor: "middle", fill: col, font: M });
  }

  return doc(W, H, b);
}

// ---------------------------------------------------------------- encode
const OUT = resolve("../images");
mkdirSync(OUT, { recursive: true });

console.log(`rendering ${FRAMES} frames...`);
const raws = [];
for (let f = 0; f < FRAMES; f++) {
  const t = +(f * DT).toFixed(4);
  const svg = frame(t, tokenAt[f]);
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  raws.push(data);
}

// one shared palette, sampled across every frame, so colours stay stable
const stride = 11;
const per = Math.floor((W * H) / stride);
const sample = new Uint8Array(raws.length * per * 4);
let o = 0;
for (const r of raws) {
  for (let p = 0; p < per; p++) {
    const q = p * stride * 4;
    sample[o++] = r[q];
    sample[o++] = r[q + 1];
    sample[o++] = r[q + 2];
    sample[o++] = 255;
  }
}
const palette = quantize(sample, 128, { format: "rgb565" });

const gif = GIFEncoder();
for (let f = 0; f < raws.length; f++) {
  const index = applyPalette(raws[f], palette, "rgb565");
  gif.writeFrame(index, W, H, { palette, delay: DT * 1000, repeat: 0 });
}
gif.finish();

const bytes = gif.bytes();
writeFileSync(resolve(OUT, "03-token-bucket.gif"), bytes);
console.log(`03-token-bucket.gif  ${W}x${H}  ${FRAMES} frames  ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);

// a representative still, for places that will not play a GIF
const stillT = 1.9;
const stillTokens = tokenAt[Math.round(stillT / DT)];
const stillSvg = frame(stillT, stillTokens);
writeFileSync(resolve(OUT, "03-token-bucket.svg"), stillSvg);
await sharp(Buffer.from(stillSvg), { density: 108 }).png({ compressionLevel: 9 }).toFile(resolve(OUT, "03-token-bucket.png"));
console.log("03-token-bucket.png written");
