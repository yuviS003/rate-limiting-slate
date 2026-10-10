import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "publish");
const REPO = "https://github.com/yuviS003/rate-limiting-slate";
const PAGES = "https://yuvis003.github.io/rate-limiting-slate";

mkdirSync(OUT, { recursive: true });
let article = readFileSync(resolve(ROOT, "rate-limiting-article.md"), "utf8");

const publicTarget = (target) => {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return target;
  const [path, fragment] = target.split("#");
  let base;
  if (path === "rate-limiting-playground.html") base = `${PAGES}/${path}`;
  else if (path.startsWith("images/") || path.startsWith("videos/")) base = `${PAGES}/${path}`;
  else base = `${REPO}/blob/main/${path}`;
  return fragment ? `${base}#${fragment}` : base;
};

// Make every relative destination usable after content leaves GitHub.
article = article.replace(/\]\(([^)]+)\)/g, (whole, target) => `](${publicTarget(target.trim())})`);

// LinkedIn editors commonly strip <details>. Keep the exercise and make the
// answer a visible block that the author can place after a spacer/divider.
article = article.replace(
  /<details>\s*<summary>Reveal the answer<\/summary>\s*([\s\S]*?)\s*<\/details>/g,
  (_whole, body) => {
    const quoted = body.trim().split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
    return `> **Answer — reveal after making your prediction**\n>\n${quoted}`;
  },
);

const note = `> **LINKEDIN EDITOR COPY — remove this note before publishing**\n>\n> Cover: \`images/00-cover.png\`  \n> Live lab: ${PAGES}/rate-limiting-playground.html  \n> Source: ${REPO}  \n> Image links below are public, but upload the local PNG/GIF files manually for reliable LinkedIn rendering.\n\n`;

writeFileSync(resolve(OUT, "linkedin-article.md"), note + article);
writeFileSync(resolve(OUT, "linkedin-launch-post.md"), `# LinkedIn launch post\n\nMost rate-limiting articles stop at \"100 requests/minute.\"\n\nThat rule silently changes when you add a second Node process. And request rate alone cannot see a 30-second PDF job, a million-node GraphQL query, or an overloaded fleet.\n\nSo I built the guide I wish I had earlier:\n\n- six algorithms in bare JavaScript;\n- the Redis race that silently overshoots;\n- atomic Lua across many pods;\n- Redis + Postgres without putting the database on the hot path;\n- crash-safe idempotent settlement;\n- concurrency, weighted cost, LLM reservations, adaptive limits, and load shedding;\n- 15 original visuals, two animations, and an interactive browser lab.\n\nThe deeper lesson: a rate limiter is not middleware that says \"no.\" It is a scheduler deciding how shared capacity is divided when demand exceeds supply.\n\nRead the article: [PASTE LINKEDIN ARTICLE URL]\n\nTry the interactive lab: ${PAGES}/rate-limiting-playground.html\n\nBrowse the verified code: ${REPO}\n\nWhich failure have you seen first: a retry storm, a noisy tenant, or a slow endpoint?\n\n#SystemDesign #NodeJS #Redis #BackendEngineering #DistributedSystems\n`);
writeFileSync(resolve(OUT, "README.md"), `# Publishing output\n\n- \`linkedin-article.md\`: canonical article with absolute public links and LinkedIn-safe answer blocks.\n- \`linkedin-launch-post.md\`: short launch post; replace the article URL placeholder after publishing.\n- \`linkedin-campaign-calendar.md\`: manually maintained dated campaign with copy-ready follow-up posts.\n\nUpload images manually using the order in \`../publishing-guide.md\`.\n`);

console.log("Generated publish/linkedin-article.md");
console.log("Generated publish/linkedin-launch-post.md");
console.log(`Repository: ${REPO}`);
console.log(`Playground: ${PAGES}/rate-limiting-playground.html`);
