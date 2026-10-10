import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const ARTICLE = resolve(ROOT, "rate-limiting-article.md");
const errors = [];
const article = readFileSync(ARTICLE, "utf8");

// Local Markdown links and images must resolve.
const links = [...article.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)].map((m) => m[1].trim());
for (const target of links) {
  if (/^(https?:|mailto:|#)/i.test(target)) continue;
  const clean = decodeURIComponent(target.split("#")[0]);
  const full = resolve(dirname(ARTICLE), clean);
  if (!existsSync(full)) errors.push(`broken local link: ${target}`);
}

// Every raster must stay below Kiro's many-image 2000px bound.
const imageDir = resolve(ROOT, "images");
const rasters = readdirSync(imageDir).filter((f) => /\.(png|gif)$/i.test(f));
for (const file of rasters) {
  const meta = await sharp(resolve(imageDir, file)).metadata();
  if (meta.width > 2000 || meta.height > 2000) {
    errors.push(`${file} is ${meta.width}x${meta.height}, above 2000px`);
  }
}

// The playground script must at least parse, and the expected activities exist.
const html = readFileSync(resolve(ROOT, "rate-limiting-playground.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) errors.push("playground script block missing");
else {
  try { new Function(script); } catch (error) { errors.push(`playground syntax: ${error.message}`); }
}
for (const id of ["lab", "movie", "scenario", "code", "quiz"]) {
  if (!html.includes(`id="${id}"`)) errors.push(`playground section #${id} missing`);
}

for (const file of ["token-bucket.mp4", "redis-race.mp4"]) {
  const full = resolve(ROOT, "videos", file);
  if (!existsSync(full) || statSync(full).size < 10_000) errors.push(`video missing or empty: ${file}`);
}

for (const heading of ["# Act I", "# Act II", "# Act III", "# Act IV"]) {
  if (!article.includes(heading)) errors.push(`article section missing: ${heading}`);
}

const words = (article.replace(/```[\s\S]*?```/g, " ").match(/[A-Za-z0-9][A-Za-z0-9’'/-]*/g) ?? []).length;
const external = links.filter((l) => /^https?:/i.test(l)).length;

if (errors.length) {
  console.error(errors.map((e) => `FAIL  ${e}`).join("\n"));
  process.exit(1);
}

console.log(`article prose:       ${words.toLocaleString()} words`);
console.log(`local links checked: ${links.length - external}`);
console.log(`external references: ${external}`);
console.log(`raster assets:       ${rasters.length}, all <= 2000px`);
console.log("playground:          script parses; 5 activity sections present");
console.log("videos:              2 present");
console.log("package validation passed");
