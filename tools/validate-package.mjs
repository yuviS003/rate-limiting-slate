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
  if (!existsSync(full) || statSync(full).size <= 75 * 1024) errors.push(`video missing or not above LinkedIn's 75 KB minimum: ${file}`);
}

for (const heading of ["# Act I", "# Act II", "# Act III", "# Act IV"]) {
  if (!article.includes(heading)) errors.push(`article section missing: ${heading}`);
}

const pastePath = resolve(ROOT, "publish", "linkedin-paste.html");
if (!existsSync(pastePath)) errors.push("LinkedIn rich-text copier missing");
else {
  const pastePage = readFileSync(pastePath, "utf8");
  const sections = pastePage.match(/class="copy-card"/g)?.length ?? 0;
  if (sections !== 6) errors.push(`LinkedIn copier has ${sections} sections instead of 6`);
  if (!pastePage.includes("ClipboardItem") || !pastePage.includes("ADD IMAGE HERE")) {
    errors.push("LinkedIn copier controls or image markers missing");
  }
}

const campaignPath = resolve(ROOT, "publish", "linkedin-campaign-calendar.md");
if (!existsSync(campaignPath)) errors.push("LinkedIn campaign calendar missing");
else {
  const campaign = readFileSync(campaignPath, "utf8");
  for (let i = 1; i <= 9; i++) {
    if (!campaign.includes(`# Post ${i} —`)) errors.push(`campaign Post ${i} missing`);
  }
  const assets = [...campaign.matchAll(/`((?:images|videos)\/[A-Za-z0-9._/-]+)`/g)].map((m) => m[1]);
  for (const asset of new Set(assets)) {
    if (!existsSync(resolve(ROOT, asset))) errors.push(`campaign asset missing: ${asset}`);
  }
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
console.log("LinkedIn copier:     6 rich-text sections present");
console.log("videos:              2 present");
console.log("LinkedIn campaign:   9 posts with existing assets");
console.log("package validation passed");
