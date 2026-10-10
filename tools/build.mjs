import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("../images");
mkdirSync(OUT, { recursive: true });

const only = process.argv[2]; // e.g. "01"

const targets = [
  ["00-cover", () => import("./d00.mjs")],
  ["01-why-rate-limiting", () => import("./d01.mjs")],
  ["02-fixed-window", () => import("./d02.mjs")],
  ["04-memory-vs-redis", () => import("./d04.mjs")],
  ["05-backoff-jitter", () => import("./d05.mjs")],
  ["06-cheatsheet", () => import("./d06.mjs")],
  ["08-journey", () => import("./d08.mjs")],
  ["09-redis-postgres", () => import("./d09.mjs")],
  ["10-rate-vs-concurrency", () => import("./d10.mjs")],
  ["11-cost-based", () => import("./d11.mjs")],
  ["12-defense-in-depth", () => import("./d12.mjs")],
  ["13-adaptive", () => import("./d13.mjs")],
  ["14-decision-tree", () => import("./d14.mjs")],
];

for (const [name, load] of targets) {
  if (only && !name.startsWith(only)) continue;
  const { build } = await load();
  const svg = build();
  writeFileSync(resolve(OUT, `${name}.svg`), svg);
  // 108 DPI renders a 1200px SVG at 1800px. Keep every static image below
  // Kiro's 2000px many-image request limit while retaining upload quality.
  await sharp(Buffer.from(svg), { density: 108 }).png({ compressionLevel: 9 }).toFile(resolve(OUT, `${name}.png`));
  const m = await sharp(resolve(OUT, `${name}.png`)).metadata();
  console.log(`${name}.png  ${m.width}x${m.height}`);
}
