import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { marked } from "marked";

const ROOT = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(ROOT, "publish", "linkedin-article.md"), "utf8");

// Start at the first real body paragraph. LinkedIn already has dedicated title,
// subtitle, and cover fields, so none of those belongs in the pasted body.
const bodyStart = source.indexOf("**A visual, code-first field guide");
if (bodyStart < 0) throw new Error("Could not find article body start");
const body = source.slice(bodyStart);
const segments = body.split(/(?=^# )/m);
const pick = (prefix) => segments.find((s) => s.startsWith(prefix)) ?? "";
const after = (prefix) => {
  const index = segments.findIndex((s) => s.startsWith(prefix));
  return index < 0 ? [] : segments.slice(index);
};

const sections = [
  { title: "Opening and the cast", markdown: segments[0] + pick("# The cast") },
  { title: "Act I — Bare JavaScript", markdown: pick("# Act I") },
  { title: "Act II — Shared Redis", markdown: pick("# Act II") },
  { title: "Act III — Redis and Postgres", markdown: pick("# Act III") },
  { title: "Act IV — Beyond request rate", markdown: pick("# Act IV") },
  {
    title: "Client retries, production guide, and conclusion",
    markdown: segments
      .filter((s) => !["# The cast", "# Act I", "# Act II", "# Act III", "# Act IV"].some((p) => s.startsWith(p)))
      .slice(1)
      .join(""),
  },
].filter((s) => s.markdown.trim());

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const cards = sections.map((section, index) => {
  let html = marked.parse(section.markdown, { gfm: true });
  // The body hierarchy starts at H2 because LinkedIn owns the article H1.
  html = html
    .replaceAll("<h3", "<h4").replaceAll("</h3>", "</h4>")
    .replaceAll("<h2", "<h3").replaceAll("</h2>", "</h3>")
    .replaceAll("<h1", "<h2").replaceAll("</h1>", "</h2>");
  const images = [...section.markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((m) => basename(new URL(m[1]).pathname));
  return `<section class="copy-card" data-section="${index + 1}">
    <header class="card-head">
      <div><span>SECTION ${index + 1} OF ${sections.length}</span><h2>${escapeHtml(section.title)}</h2></div>
      <button class="copy-section">Copy this section</button>
    </header>
    ${images.length ? `<p class="assets"><strong>Images in this section:</strong> ${images.map(escapeHtml).join(", ")}</p>` : ""}
    <article class="article-section">${html}</article>
  </section>`;
}).join("\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LinkedIn Rich-Text Copier — Rate Limiting</title>
<style>
:root{color-scheme:light;--ink:#171717;--muted:#666;--line:#d9d9d9;--blue:#0a66c2;--panel:#f7f8fa;--good:#087f5b}
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:var(--ink);font:16px/1.6 Segoe UI,Arial,sans-serif}.shell{width:min(960px,calc(100% - 24px));margin:auto}
.hero{background:#101827;color:white;padding:34px 0}.hero h1{font-size:34px;margin:0 0 8px}.hero p{color:#bec9db;margin:0}.steps{background:#fff4cf;border:1px solid #ecd477;border-radius:10px;padding:16px 20px;margin:22px 0}.steps h2{margin:0 0 8px;font-size:20px}.steps ol{margin:0;padding-left:22px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.field{background:white;border:1px solid var(--line);border-radius:10px;padding:14px}.field small{display:block;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:.08em}.field strong{display:block;margin:5px 0 10px}.field button,.copy-section,.copy-all{background:var(--blue);border:0;color:white;border-radius:7px;padding:9px 13px;font-weight:700;cursor:pointer}.copy-all{background:var(--good);font-size:16px;margin-top:14px}.copy-card{background:white;border:1px solid var(--line);border-radius:12px;margin:18px 0 28px;overflow:hidden}.card-head{display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--panel);border-bottom:1px solid var(--line);padding:14px 18px}.card-head span{font-size:11px;color:var(--blue);font-weight:800;letter-spacing:.12em}.card-head h2{font-size:20px;margin:2px 0}.assets{margin:0;padding:10px 18px;background:#eef6ff;color:#345;font-size:13px;border-bottom:1px solid #cddff1}.article-section{padding:22px 30px}.article-section h2{font-size:27px;margin:32px 0 10px}.article-section h3{font-size:22px;margin:27px 0 9px}.article-section h4{font-size:18px;margin:23px 0 7px}.article-section p{margin:10px 0}.article-section li{margin:4px 0}.article-section blockquote{margin:16px 0;padding:10px 16px;border-left:4px solid var(--blue);background:#f3f7fb}.article-section pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111827;color:#e5edf8;border-radius:8px;padding:14px;font:13px/1.55 Consolas,monospace}.article-section code:not(pre code){background:#edf0f4;border-radius:4px;padding:2px 5px}.article-section img{display:block;max-width:100%;height:auto;margin:20px auto;border-radius:8px}.article-section table{border-collapse:collapse;width:100%;margin:18px 0}.article-section th,.article-section td{border:1px solid #ccc;padding:8px;text-align:left}.article-section a{color:var(--blue)}.article-section hr{border:0;border-top:1px solid #ddd;margin:28px 0}.status{position:fixed;right:18px;bottom:18px;background:#152238;color:white;padding:10px 14px;border-radius:8px;opacity:0;transform:translateY(8px);transition:.2s}.status.show{opacity:1;transform:none}.warning{color:#8a5600;font-weight:700}.image-marker{border:2px dashed #0a66c2!important;background:#eef6ff!important;color:#083c6c!important;padding:14px!important;text-align:center!important;font-weight:700!important;margin:20px 0!important}.table-cards{border-left:3px solid #777;padding-left:14px}.table-row{margin:12px 0}.table-row strong{display:block}footer{padding:25px 0 50px;color:var(--muted);text-align:center}@media(max-width:650px){.fields{grid-template-columns:1fr}.card-head{align-items:flex-start;flex-direction:column}.article-section{padding:18px}.copy-section{width:100%}}
</style>
</head>
<body>
<header class="hero"><div class="shell"><h1>LinkedIn Rich-Text Copier</h1><p>This page—not the Markdown file—is what you copy from.</p></div></header>
<main class="shell">
<section class="steps">
<h2>Do this in LinkedIn now</h2>
<ol>
<li>Keep the cover, title, and subtitle already entered.</li>
<li><strong>Delete the broken body</strong> containing <code>#</code>, <code>##</code>, or <code>![...]</code>.</li>
<li>Copy and paste each of the six sections below, in order.</li>
<li>Whenever you see a blue <span class="warning">ADD IMAGE HERE</span> marker, delete that marker and upload the named local image.</li>
<li>Use LinkedIn's code button on any code block that loses its dark formatting.</li>
</ol>
<button class="copy-all">Copy entire body (sections are safer)</button>
</section>
<div class="fields">
<div class="field"><small>LinkedIn title field</small><strong>The Night One Client Ate the API</strong><button data-copy="The Night One Client Ate the API">Copy title</button></div>
<div class="field"><small>LinkedIn subtitle field</small><strong>Rate limiting from 15 lines of JavaScript to Redis, Postgres, and adaptive concurrency</strong><button data-copy="Rate limiting from 15 lines of JavaScript to Redis, Postgres, and adaptive concurrency">Copy subtitle</button></div>
</div>
${cards}
</main>
<div class="status">Copied</div>
<footer><div class="shell">After all sections are pasted, remove every blue image marker, upload its named asset, preview, and publish.</div></footer>
<script>
const status=document.querySelector('.status');
const flash=(text)=>{status.textContent=text;status.classList.add('show');setTimeout(()=>status.classList.remove('show'),1600)};
function tableToCards(table){
  const headers=[...table.querySelectorAll('thead th')].map(x=>x.innerText.trim());
  const wrap=document.createElement('div');wrap.className='table-cards';
  for(const row of table.querySelectorAll('tbody tr')){
    const card=document.createElement('div');card.className='table-row';
    const cells=[...row.children];
    card.innerHTML=cells.map((cell,i)=>'<p><strong>'+escapeHtml(headers[i]||'Item')+'</strong>'+cell.innerHTML+'</p>').join('');
    wrap.append(card);
  }
  table.replaceWith(wrap);
}
function escapeHtml(text){const d=document.createElement('div');d.textContent=text;return d.innerHTML}
function preparedClone(article){
  const clone=article.cloneNode(true);
  for(const image of clone.querySelectorAll('img')){
    const marker=document.createElement('p');marker.className='image-marker';
    marker.textContent='📷 ADD IMAGE HERE — '+image.src.split('/').pop()+' — then delete this line';
    image.replaceWith(marker);
  }
  for(const table of [...clone.querySelectorAll('table')])tableToCards(table);
  return clone;
}
async function copyRich(nodes,label){
  const holder=document.createElement('div');for(const node of nodes)holder.append(preparedClone(node));
  const html=holder.innerHTML,plain=holder.innerText;
  try{
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
  }catch(error){
    document.body.append(holder);const range=document.createRange();range.selectNodeContents(holder);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('copy');selection.removeAllRanges();holder.remove();
  }
  flash(label+' copied');
}
document.querySelectorAll('.copy-section').forEach(button=>button.onclick=()=>copyRich([button.closest('.copy-card').querySelector('.article-section')],button.closest('.copy-card').dataset.section));
document.querySelector('.copy-all').onclick=()=>copyRich([...document.querySelectorAll('.article-section')],'Entire body');
document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{await navigator.clipboard.writeText(button.dataset.copy);flash('Field')});
</script>
</body>
</html>`;

writeFileSync(resolve(ROOT, "publish", "linkedin-paste.html"), page);
console.log(`Generated publish/linkedin-paste.html with ${sections.length} copyable sections`);
