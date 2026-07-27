#!/usr/bin/env node
/**
 * Build interactive local review gallery for Zelenoe Yabloko images.
 *
 * Does NOT change production / VPS / DB / image_url.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  build_zy_sku,
  parse_zy_product_name,
} from "../../src/lib/catalog/external-images/zy-parse-name";
import {
  normalize_package,
  parse_volume_ml,
} from "../../src/lib/catalog/external-images/normalize";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

type ManifestItem = {
  source_index: number;
  source_name: string;
  brand: string;
  flavor: string;
  volume_text: string;
  package_type: string;
  source_product_url: string;
  candidate_image_url: string;
  local_original_path: string;
  local_preview_path: string;
  mime_type: string;
  extension: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  sha256: string;
  match_status: string;
  tinda_sku: string;
  download_status: string;
  error_message: string;
  duplicate_of: string;
};

type ReviewRow = Record<string, unknown>;

function load_review_by_url(review_path: string): Map<string, ReviewRow> {
  const map = new Map<string, ReviewRow>();
  if (!existsSync(review_path)) return map;
  const wb = XLSX.readFile(review_path);
  const priority: Record<string, number> = {
    exact_match: 4,
    conflict: 3,
    probable_match: 2,
    new_product: 1,
    no_match: 0,
  };
  for (const name of wb.SheetNames) {
    if (name === "Инструкция") continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      defval: "",
    }) as ReviewRow[];
    for (const r of rows) {
      const url = String(r.candidate_image_url || "").trim();
      if (!url) continue;
      let status = String(r.match_status || "");
      if (name === "Новые товары") status = "new_product";
      const prev = map.get(url);
      const prev_status = String(prev?.match_status || "");
      if (
        !prev ||
        (priority[status] ?? -1) > (priority[prev_status] ?? -1)
      ) {
        map.set(url, { ...r, match_status: status });
      }
    }
  }
  return map;
}

function rel_preview(abs: string, root: string): string {
  if (!abs) return "";
  const base = path.basename(abs);
  if (abs.includes(`${path.sep}previews${path.sep}`) || abs.includes("/previews/")) {
    return `previews/${base}`;
  }
  if (abs.includes(`${path.sep}original${path.sep}`) || abs.includes("/original/")) {
    return `original/${base}`;
  }
  // fallback
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

function main() {
  const root = path.resolve(
    arg("out-dir", "data/imports/zelenoe-yabloko-images")!,
  );
  const manifest_path = path.join(root, "manifest.json");
  const candidates_path = path.resolve(
    arg("candidates", "data/imports/zelenoe_yabloko_gazirovannye_candidates.json")!,
  );
  const review_path = path.resolve(
    arg("review", "data/imports/zelenoe_yabloko_gazirovannye_images_review.xlsx")!,
  );

  const manifest = JSON.parse(readFileSync(manifest_path, "utf8")) as {
    items: ManifestItem[];
  };
  const candidates = JSON.parse(readFileSync(candidates_path, "utf8")) as Array<
    Record<string, unknown>
  >;
  const cand_by_url = new Map(
    candidates.map((c) => [String(c.candidate_image_url || ""), c]),
  );
  const review_by_url = load_review_by_url(review_path);

  const seq_by_prefix = new Map<string, number>();
  const cards = manifest.items.map((item) => {
    const rev = review_by_url.get(item.candidate_image_url);
    const cand = cand_by_url.get(item.candidate_image_url);
    const match_status =
      String(rev?.match_status || item.match_status || "unknown");
    const tinda_volume = String(rev?.tinda_volume || "");
    const tinda_name = String(rev?.tinda_name || "");
    const comment = String(rev?.review_comment || "");
    const volume_match = (() => {
      if (match_status === "new_product") return null;
      if (comment.includes("volume_exact") || comment.includes("volume_near")) {
        return true;
      }
      if (comment.includes("volume_mismatch")) return false;
      const a = parse_volume_ml(item.volume_text);
      const b = parse_volume_ml(tinda_volume);
      if (a == null || b == null) return null;
      return a === b;
    })();
    const package_match = (() => {
      if (match_status === "new_product") return null;
      if (comment.includes("package_exact")) return true;
      if (comment.includes("package_mismatch")) return false;
      const a = normalize_package(item.package_type);
      const b = normalize_package(tinda_name);
      if (!a || !b) return null;
      return a === b;
    })();

    const parsed = parse_zy_product_name(item.source_name);
    const prefix = `${parsed.brand}|${parsed.volume_ml}|${parsed.package_code}`;
    const seq = (seq_by_prefix.get(prefix) || 0) + 1;
    seq_by_prefix.set(prefix, seq);
    const proposed_sku = build_zy_sku(
      parsed.brand,
      parsed.volume_ml,
      parsed.package_code,
      seq,
    );

    const below_500 =
      (item.width != null && item.width < 500) ||
      (item.height != null && item.height < 500);

    return {
      source_index: item.source_index,
      source_name: item.source_name,
      brand: item.brand,
      flavor: item.flavor,
      volume_text: item.volume_text,
      package_type: item.package_type,
      source_product_url: item.source_product_url,
      candidate_image_url: item.candidate_image_url,
      local_original_path: item.local_original_path,
      preview_path: rel_preview(item.local_preview_path, root),
      original_path: rel_preview(item.local_original_path, root),
      mime_type: item.mime_type,
      extension: item.extension,
      width: item.width,
      height: item.height,
      file_size: item.file_size,
      sha256: item.sha256,
      match_status,
      match_score: Number(rev?.match_score || 0) || null,
      tinda_product_id: String(rev?.tinda_product_id || ""),
      tinda_sku: String(rev?.tinda_sku || item.tinda_sku || ""),
      tinda_name: tinda_name,
      tinda_volume,
      current_image_url: String(rev?.current_image_url || ""),
      volume_match,
      package_match,
      source_price_reference:
        cand?.source_price_reference ?? rev?.source_price_reference ?? "",
      proposed_sku,
      below_500,
      download_status: item.download_status,
      review_status: "pending",
      review_comment: "",
    };
  });

  const stats = cards.reduce(
    (acc, c) => {
      acc[c.match_status] = (acc[c.match_status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const data = {
    generated_at: new Date().toISOString(),
    title: "Зелёное яблоко — локальный review",
    cards,
    stats,
    decisions_url: "./review-decisions.json",
    note: "Local review only. No production changes.",
  };

  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, "gallery-data.json"),
    JSON.stringify(data, null, 2),
  );

  const html = build_html();
  writeFileSync(path.join(root, "gallery.html"), html);

  console.log(
    JSON.stringify(
      {
        gallery: path.join(root, "gallery.html"),
        data: path.join(root, "gallery-data.json"),
        cards: cards.length,
        stats,
      },
      null,
      2,
    ),
  );
}

function build_html(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Зелёное яблоко — review галерея</title>
<style>
:root{
  --bg:#f2efe7; --ink:#1b1914; --muted:#5f584c; --line:#d7d0c2;
  --card:#fffdf8; --ok:#2f6b3a; --warn:#8a5a00; --bad:#8b2e2e; --chip:#e8efe4;
}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI","Helvetica Neue",sans-serif;color:var(--ink);
  background:radial-gradient(circle at 8% 0,#e7f0df,transparent 42%),radial-gradient(circle at 92% 8%,#efe6d4,transparent 36%),var(--bg)}
header{position:sticky;top:0;z-index:20;backdrop-filter:blur(10px);background:rgba(242,239,231,.92);border-bottom:1px solid var(--line)}
.wrap{max-width:1280px;margin:0 auto;padding:16px 20px}
h1{margin:0 0 6px;font-size:1.35rem;letter-spacing:-.02em}
.sub{margin:0;color:var(--muted);font-size:.92rem}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.filters button,.actions button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 12px;cursor:pointer;font:inherit;font-size:.85rem}
.filters button.active{background:var(--ok);color:#fff;border-color:var(--ok)}
.actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.actions button.primary{background:var(--ok);color:#fff;border-color:var(--ok)}
#status{font-size:.85rem;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;padding:16px 20px 48px;max-width:1280px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px}
.card.hidden{display:none}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.shot{background:#fff;border:1px solid var(--line);border-radius:12px;aspect-ratio:1;display:grid;place-items:center;overflow:hidden}
.shot img{width:100%;height:100%;object-fit:contain}
.shot .lbl{font-size:.72rem;color:var(--muted);padding:4px 6px;justify-self:start;align-self:start;position:absolute}
.shot-wrap{position:relative}
.single{aspect-ratio:1;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:grid;place-items:center}
.single img{width:100%;height:100%;object-fit:contain}
h2{margin:0;font-size:.98rem;line-height:1.3}
.meta{display:grid;gap:4px;font-size:.82rem}
.meta div{display:grid;grid-template-columns:120px 1fr;gap:6px}
.meta dt{color:var(--muted)}
.meta dd{margin:0;word-break:break-word}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--chip);color:var(--ok);font-weight:600}
.warn{color:var(--warn);font-weight:600;font-size:.82rem;background:#fff4df;border:1px solid #f0d7a0;border-radius:10px;padding:8px}
.choices{display:grid;gap:6px}
.choices label{display:flex;gap:8px;align-items:flex-start;font-size:.84rem;padding:6px 8px;border:1px solid var(--line);border-radius:10px;cursor:pointer;background:#fff}
.choices input{margin-top:2px}
textarea{width:100%;min-height:58px;border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit;resize:vertical}
a.src{color:var(--ok);font-size:.84rem;text-decoration:none}
a.src:hover{text-decoration:underline}
.yes{color:var(--ok);font-weight:600}.no{color:var(--bad);font-weight:600}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Зелёное яблоко — локальный review</h1>
    <p class="sub">Production / VPS / image_url не меняются. Решения только локально.</p>
    <div class="toolbar">
      <div class="filters" id="filters"></div>
      <div class="actions">
        <button type="button" class="primary" id="btn-save">Сохранить решения</button>
        <button type="button" id="btn-json">Экспортировать JSON</button>
        <button type="button" id="btn-xlsx">Экспортировать Excel</button>
      </div>
    </div>
    <p id="status">Загрузка…</p>
  </div>
</header>
<main class="grid" id="grid"></main>
<script>
const LS_KEY = "zy_gallery_decisions_v1";
const FILTERS = [
  ["all","Все"],
  ["exact_match","exact_match"],
  ["probable_match","probable_match"],
  ["new_product","new_product"],
  ["conflict","conflict"],
  ["below_500","меньше 500×500"],
  ["approved_existing","approved_existing"],
  ["approved_new","approved_new"],
  ["rejected","rejected"],
  ["pending","pending"],
];
const REVIEW_OPTS = [
  ["pending","pending — ещё не проверено"],
  ["approved_existing","approved_existing — для существующего товара"],
  ["approved_new","approved_new — для нового товара"],
  ["rejected","rejected — не использовать"],
];

let DATA = null;
let decisions = {}; // source_index -> {review_status, review_comment}
let activeFilter = "all";

function esc(s){
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function yn(v){
  if(v===null||v===undefined) return "—";
  return v ? '<span class="yes">да</span>' : '<span class="no">нет</span>';
}
function getDec(card){
  const d = decisions[card.source_index] || {};
  return {
    review_status: d.review_status || card.review_status || "pending",
    review_comment: d.review_comment ?? card.review_comment ?? "",
  };
}
function setDec(index, patch){
  decisions[index] = { ...getDec({source_index:index, ...decisions[index]}), ...patch };
  localStorage.setItem(LS_KEY, JSON.stringify(decisions));
  updateStatus();
  applyFilter();
}
function buildDecisionRows(){
  return DATA.cards.map(c => {
    const d = getDec(c);
    return {
      source_index: c.source_index,
      source_name: c.source_name,
      source_product_url: c.source_product_url,
      candidate_image_url: c.candidate_image_url,
      local_original_path: c.local_original_path,
      preview_path: c.preview_path,
      match_status: c.match_status,
      match_score: c.match_score,
      tinda_product_id: c.tinda_product_id,
      tinda_sku: c.tinda_sku,
      tinda_name: c.tinda_name,
      review_status: d.review_status,
      review_comment: d.review_comment,
      width: c.width,
      height: c.height,
      sha256: c.sha256,
    };
  });
}
function updateStatus(){
  const rows = buildDecisionRows();
  const counts = {pending:0,approved_existing:0,approved_new:0,rejected:0};
  for (const r of rows) counts[r.review_status] = (counts[r.review_status]||0)+1;
  const ms = DATA.stats || {};
  document.getElementById("status").textContent =
    \`Карточек: \${rows.length}. match: exact=\${ms.exact_match||0}, probable=\${ms.probable_match||0}, new=\${ms.new_product||0}, conflict=\${ms.conflict||0}, unknown=\${ms.unknown||0}. Решения: pending=\${counts.pending||0}, approved_existing=\${counts.approved_existing||0}, approved_new=\${counts.approved_new||0}, rejected=\${counts.rejected||0}.\`;
}
function cardMatchesFilter(card, filter){
  const d = getDec(card);
  if(filter==="all") return true;
  if(filter==="below_500") return !!card.below_500;
  if(["approved_existing","approved_new","rejected","pending"].includes(filter)) return d.review_status===filter;
  return card.match_status===filter;
}
function applyFilter(){
  activeFilter = document.querySelector(".filters button.active")?.dataset.filter || "all";
  for (const el of document.querySelectorAll(".card")){
    const idx = Number(el.dataset.index);
    const card = DATA.cards.find(c=>c.source_index===idx);
    el.classList.toggle("hidden", !cardMatchesFilter(card, activeFilter));
  }
}
function renderFilters(){
  const box = document.getElementById("filters");
  box.innerHTML = FILTERS.map(([id,label]) =>
    \`<button type="button" data-filter="\${id}" class="\${id===activeFilter?"active":""}">\${esc(label)}</button>\`
  ).join("");
  box.onclick = (e)=>{
    const b = e.target.closest("button");
    if(!b) return;
    for (const x of box.querySelectorAll("button")) x.classList.remove("active");
    b.classList.add("active");
    applyFilter();
  };
}
function renderCard(c){
  const d = getDec(c);
  const isCompare = c.match_status==="exact_match" || c.match_status==="probable_match" || c.match_status==="conflict";
  const imgNew = c.preview_path || c.original_path || "";
  let media = "";
  if(isCompare){
    media = \`<div class="compare">
      <div class="shot-wrap shot"><div class="lbl">ТИНДА сейчас</div>\${c.current_image_url?\`<img src="\${esc(c.current_image_url)}" alt="current" loading="lazy" referrerpolicy="no-referrer" />\`:\`<span>нет фото</span>\`}</div>
      <div class="shot-wrap shot"><div class="lbl">Зелёное яблоко</div>\${imgNew?\`<img src="\${esc(imgNew)}" alt="candidate" loading="lazy" />\`:\`<span>нет фото</span>\`}</div>
    </div>
    <div class="meta">
      <div><dt>SKU</dt><dd>\${esc(c.tinda_sku||"—")}</dd></div>
      <div><dt>ТИНДА</dt><dd>\${esc(c.tinda_name||"—")}</dd></div>
      <div><dt>match_score</dt><dd>\${c.match_score??"—"}</dd></div>
      <div><dt>объём</dt><dd>\${yn(c.volume_match)} (\${esc(c.volume_text)} / \${esc(c.tinda_volume||"—")})</dd></div>
      <div><dt>упаковка</dt><dd>\${yn(c.package_match)} (\${esc(c.package_type)})</dd></div>
    </div>\`;
  } else {
    // new_product / unknown
    media = \`<div class="single">\${imgNew?\`<img src="\${esc(imgNew)}" alt="candidate" loading="lazy" />\`:\`<span>нет фото</span>\`}</div>
    <div class="warn">Товар ещё не создан в ТИНДА. Не импортировать автоматически.</div>
    <div class="meta">
      <div><dt>source_name</dt><dd>\${esc(c.source_name)}</dd></div>
      <div><dt>бренд</dt><dd>\${esc(c.brand)}</dd></div>
      <div><dt>вкус</dt><dd>\${esc(c.flavor||"—")}</dd></div>
      <div><dt>объём</dt><dd>\${esc(c.volume_text||"—")}</dd></div>
      <div><dt>упаковка</dt><dd>\${esc(c.package_type||"—")}</dd></div>
      <div><dt>цена источника</dt><dd>\${esc(c.source_price_reference||"—")} <em>(справочно)</em></dd></div>
      <div><dt>proposed SKU</dt><dd>\${esc(c.proposed_sku)}</dd></div>
    </div>\`;
  }
  const choices = REVIEW_OPTS.map(([v,label]) =>
    \`<label><input type="radio" name="rev-\${c.source_index}" value="\${v}" \${d.review_status===v?"checked":""}/> \${esc(label)}</label>\`
  ).join("");
  return \`<article class="card" data-index="\${c.source_index}" data-match="\${esc(c.match_status)}">
    \${media}
    <h2>\${esc(c.source_name)}</h2>
    <div class="meta">
      <div><dt>match_status</dt><dd><span class="badge">\${esc(c.match_status)}</span></dd></div>
      <div><dt>размер</dt><dd>\${c.width&&c.height?\`\${c.width}×\${c.height}\`:"—"}\${c.below_500?" · &lt;500":""}</dd></div>
    </div>
    <div class="choices">\${choices}</div>
    <label style="font-size:.82rem;color:var(--muted)">review_comment
      <textarea data-comment="\${c.source_index}" placeholder="Комментарий...">\${esc(d.review_comment)}</textarea>
    </label>
    <a class="src" href="\${esc(c.source_product_url)}" target="_blank" rel="noopener">Карточка источника</a>
  </article>\`;
}
function render(){
  document.getElementById("grid").innerHTML = DATA.cards.map(renderCard).join("");
  document.getElementById("grid").addEventListener("change", (e)=>{
    const t = e.target;
    if(t.matches('input[type="radio"]')){
      const idx = Number(t.name.replace("rev-",""));
      setDec(idx, {review_status: t.value});
    }
  });
  document.getElementById("grid").addEventListener("input", (e)=>{
    const t = e.target;
    if(t.matches("textarea[data-comment]")){
      setDec(Number(t.dataset.comment), {review_comment: t.value});
    }
  });
  applyFilter();
  updateStatus();
}
async function loadDecisions(){
  try{
    const res = await fetch("./review-decisions.json", {cache:"no-store"});
    if(res.ok){
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json.items || []);
      for (const row of items){
        if(row.source_index==null) continue;
        decisions[row.source_index] = {
          review_status: row.review_status || "pending",
          review_comment: row.review_comment || "",
        };
      }
    }
  }catch(_){}
  try{
    const ls = localStorage.getItem(LS_KEY);
    if(ls){
      const parsed = JSON.parse(ls);
      // merge: file wins for keys present; then overlay newer localStorage? Prefer file first then LS for offline edits
      decisions = { ...decisions, ...parsed };
    }
  }catch(_){}
}
async function saveToServer(){
  const items = buildDecisionRows();
  const payload = {
    generated_at: new Date().toISOString(),
    note: "Local decisions only. No production changes.",
    items,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(decisions));
  const res = await fetch("/api/decisions", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload),
  });
  if(!res.ok){
    const text = await res.text();
    throw new Error(text || ("HTTP "+res.status));
  }
  return res.json();
}
function downloadBlob(filename, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function init(){
  renderFilters();
  DATA = await fetch("./gallery-data.json", {cache:"no-store"}).then(r=>r.json());
  await loadDecisions();
  render();
  document.getElementById("btn-save").onclick = async ()=>{
    try{
      const r = await saveToServer();
      alert("Сохранено:\\n"+r.json_path+"\\n"+r.xlsx_path);
      updateStatus();
    }catch(e){
      // fallback: download JSON if server unavailable
      const items = buildDecisionRows();
      downloadBlob("review-decisions.json", new Blob([JSON.stringify({generated_at:new Date().toISOString(),items},null,2)],{type:"application/json"}));
      alert("Сервер сохранения недоступен. JSON скачан в браузер. Запустите: npm run zelenoe-images:serve\\n"+e.message);
    }
  };
  document.getElementById("btn-json").onclick = async ()=>{
    try{
      const r = await saveToServer();
      window.location.href = "/api/decisions.json";
      alert("JSON обновлён: "+r.json_path);
    }catch(e){
      const items = buildDecisionRows();
      downloadBlob("review-decisions.json", new Blob([JSON.stringify({generated_at:new Date().toISOString(),items},null,2)],{type:"application/json"}));
    }
  };
  document.getElementById("btn-xlsx").onclick = async ()=>{
    try{
      await saveToServer();
      window.location.href = "/api/decisions.xlsx";
    }catch(e){
      alert("Для Excel нужен локальный сервер: npm run zelenoe-images:serve\\n"+e.message);
    }
  };
}
init().catch(e=>{
  document.getElementById("status").textContent = "Ошибка загрузки: "+e.message;
});
</script>
</body>
</html>`;
}

main();
