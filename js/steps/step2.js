// Шаг 2. Что произошло: сводка шага 1, хронология, статус, темы обращения.
// Справочник тем и правила выбора читаются из приватного operator-data (derived/claim-types.json, derived/theme-rules.md).

import { $, val, copyText, copyBtn, deepseekLink, linkOrCopy } from "../ui.js";
import { ticketUrl, orderUrl } from "../crm.js";
import { state, save } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { parseAnswer, LABELS2 } from "../parser.js";
import { ghGet, conn } from "../github.js";
import { THEMES_PATH, THEME_RULES_PATH } from "../config.js";

// значок (DR) при сравнении путей не учитывается: DeepSeek может его опустить
const norm = x => x.toLowerCase().replace(/\s*\(dr\)/g, "").replace(/\s+/g, " ").trim();
let TYPES = [], TYPE_MAP = {}, TYPE_LINES = [], SOURCE = null, RULES = "", RULES_DATE = "";
const sels = typeof document !== "undefined" ? ["t1", "t2", "t3"].map(id => document.getElementById(id)) : [];

/* ---------- Сводка шага 1 ---------- */
export function renderSummary() {
  const box = $("sum-card");
  if (!box) return;
  box.textContent = "";
  const rows = [["Тикет", "ticket"], ["Заказ", "order"], ["Проблема", "problem"], ["Требование", "demand"],
                ["Менялось позже", "changed"], ["Юридические упоминания", "legal"], ["Контакты", "contacts"], ["Задачи", "tasks"]];
  const add = (label, node) => {
    const r = document.createElement("div"); r.className = "srow";
    const l = document.createElement("span"); l.className = "slabel"; l.textContent = label;
    r.append(l, node); box.appendChild(r);
  };
  rows.forEach(([label, id]) => {
    const v = val(id);
    if (!v) return;
    add(label, id === "ticket" ? linkOrCopy(v, ticketUrl(v)) : id === "order" ? linkOrCopy(v, orderUrl(v)) : copyBtn(v));
  });
  const dtVal = val("case-datetime");
  if (dtVal) add("Дата и время", copyBtn(dtVal.replace("T", " ")));
  const slot = $("chat-link-slot");
  if (slot) slot.textContent = "в тот же чат DeepSeek, где вы разбирали претензию";
  renderThemeOrder();
}

/* Номер заказа рядом с темами: оператор переносит в тикет и то и другое */
function renderThemeOrder() {
  const slot = $("theme-order"), o = val("order");
  if (!slot) return;
  slot.textContent = "";
  if (!o) return;
  slot.append("Заказ для тикета: ", linkOrCopy(o, orderUrl(o)));
}

/* ---------- Справочник тем (3 уровня) ---------- */
function indexTypes(nodes, prefix, hidden = false) {
  nodes.forEach(n => {
    const path = [...prefix, n.name].join(" > ");
    const leaf = !(n.children && n.children.length);
    const skip = hidden || n.prompt === false;           // темы 3-й линии и «ЧС на объекте» DeepSeek не предлагаем
    TYPE_MAP[norm(path)] = { path, comment: n.comment || "", dr: !!n.dr, bind: n.bind || null, leaf, hidden: n.prompt === false };
    if (leaf && !skip) TYPE_LINES.push(path + (n.comment ? " — подсказка: " + n.comment : ""));
    if (!leaf && !skip && n.comment) TYPE_LINES.push("Направление «" + n.name + "»: " + n.comment);
    indexTypes(n.children || [], [...prefix, n.name], skip);
  });
}

/* Подсказка о привязке под выбранной темой: что привязывать к тикету */
const BIND_LABEL = { order: "заказ", package: "упаковка", item: "позиция", comment: "комментарий", promo: "ID акции" };
function bindLine(info) {
  if (!info) return null;
  const box = document.createElement("small");
  box.className = "tbind";
  if (info.hidden && info.comment) box.append(info.comment.replace(/[.\s]+$/, "") + ". ");
  if (info.dr) box.append("DR: привяжите все заказы и упаковки, по которым есть проблема. ");
  if (info.bind) {
    const keys = Object.keys(BIND_LABEL).filter(k => info.bind[k] && info.bind[k] !== "off");
    if (keys.length) {
      box.append("Привязка: ");
      keys.forEach((k, i) => {
        if (i) box.append(", ");
        box.append(BIND_LABEL[k]);
        // номер заказа с шага 1 стоит прямо в строке, следом иконка копирования (там, где привязка заказа не отключена)
        if (k === "order" && val("order")) { box.append(" "); box.append(linkOrCopy(val("order"), orderUrl(val("order")))); }
        box.append(" — " + (info.bind[k] === "req" ? "обязательно" : k === "comment" ? "по желанию" : "если есть"));
      });
    }
  }
  return box.childNodes.length ? box : null;
}

/* Голубая плашка с обоснованием DeepSeek под темой */
const SVG_NS = "http://www.w3.org/2000/svg";
function whyPlate(text) {
  const d = document.createElement("div");
  d.className = "why";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "i"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "assets/icons.svg#i-info");
  svg.append(use);
  const span = document.createElement("span"), b = document.createElement("b");
  b.textContent = "Обоснование DeepSeek: ";
  span.append(b, text);
  d.append(svg, span);
  return d;
}
function levelList(k) {
  let list = TYPES;
  for (let j = 0; j < k; j++) { const v = sels[j].value; if (v === "") return []; list = list[+v].children || []; }
  return list;
}
function fillLevel(k) {
  const s = sels[k], list = levelList(k);
  s.innerHTML = "";
  s.add(new Option(["Тип", "Подтип", "Уточнение"][k] + "…", ""));
  list.forEach((n, i) => s.add(new Option(n.name, i)));
  s.hidden = !list.length;
}
function picked() {
  const names = []; let list = TYPES, comment = "";
  for (const s of sels) {
    if (s.value === "") break;
    const n = list[+s.value]; names.push(n.name);
    if (n.comment) comment = n.comment;
    list = n.children || [];
  }
  return { path: names.join(" > "), comment };
}
const connected = () => { const c = conn(); return !!(c && c.token); };

let themesHash = null, themesDate = null;
export function getThemesVersion() {
  return { date: themesDate, hash: themesHash };
}

function renderThemeSource() {
  $("theme-source").textContent = SOURCE && SOURCE.pageDate ? "Справочник тем от " + SOURCE.pageDate + "." : "";
}

async function loadTypes() {
  TYPES = []; TYPE_MAP = {}; TYPE_LINES = []; SOURCE = null;
  const hint = $("theme-hint");
  try {
    if (!connected()) throw new Error("нет подключения к operator-data");
    const raw = await ghGet(THEMES_PATH);
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      themesHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
    } catch (e) {
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
      themesHash = (h >>> 0).toString(16);
    }
    const data = JSON.parse(raw);
    TYPES = data.types || []; SOURCE = data.source || null;
    themesDate = (SOURCE && SOURCE.pageDate) || data.date || null;
    indexTypes(TYPES, []);
    hint.textContent = "";
  } catch (e) {
    hint.textContent = connected()
      ? "Справочник тем не загружен (" + e.message + "). Проверьте подключение к operator-data; темы можно вписывать вручную."
      : "Справочник тем лежит в operator-data: подключитесь через шестерёнку вверху. Пока темы можно вписывать вручную.";
  }
  sels.forEach(s => { s.value = ""; });
  for (let k = 0; k < 3; k++) fillLevel(k);
  renderThemeSource();
  // темы, уже добавленные раньше: сверить с загруженным справочником
  if (TYPES.length) {
    state.themes.forEach(t => { const hit = TYPE_MAP[norm(t.path)]; t.unknown = !hit; if (hit) t.path = hit.path; });
    save();
  }
}

async function loadRules() {
  RULES = ""; RULES_DATE = "";
  if (!connected()) return;
  try {
    const raw = await ghGet(THEME_RULES_PATH);
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
    RULES_DATE = (fm && (fm[1].match(/^pageDate: (.*)$/m) || [])[1]) || "";
    RULES = (fm ? raw.slice(fm[0].length) : raw).trim();
  } catch (e) { RULES = ""; }
}

/* ---------- Выбранные темы ---------- */
function addTheme(path, status = "добавлю я", note = "") {
  const hit = TYPE_MAP[norm(path)];
  const p = hit ? hit.path : path;
  const normalizedStatus = (status && /тикет/i.test(status)) ? "в тикете" : "добавлю я";
  const ex = state.themes.find(t => norm(t.path) === norm(p));
  if (ex) {
    if (note && !ex.note) ex.note = note;
    if (status) ex.status = normalizedStatus;
    return;
  }
  state.themes.push({ path: p, status: normalizedStatus, note: note || "", unknown: TYPES.length > 0 && !hit });
}
/* ---------- Архив кейсов и похожие решения ---------- */
let manifestCases = [];
let manifestLoaded = false;

export async function loadManifestCases() {
  if (manifestLoaded) return manifestCases;
  try {
    if (!connected()) return [];
    const raw = await ghGet("cases/manifest.json");
    const data = JSON.parse(raw);
    manifestCases = data.cases || [];
    manifestLoaded = true;
    return manifestCases;
  } catch (e) {
    console.warn("Could not load manifest cases:", e);
    return [];
  }
}

export function resetManifestCache() {
  manifestCases = [];
  manifestLoaded = false;
}

export async function renderSimilarCases() {
  const container = $("similar-cases-list");
  if (!container) return;

  const currentThemes = (state.themes || []).map(t => (t.path || "").toLowerCase().trim()).filter(Boolean);
  const currentProblem = (val("problem") || "").toLowerCase().trim();

  if (!connected()) {
    container.innerHTML = '<p class="hint" style="margin:6px 0;">Подключитесь к operator-data через ⚙ вверху, чтобы видеть похожие кейсы из архива.</p>';
    return;
  }

  const cases = await loadManifestCases();
  if (!cases || !cases.length) {
    container.innerHTML = '<p class="hint" style="margin:6px 0;">Архив кейсов пуст или ещё не создан в cases/manifest.json.</p>';
    return;
  }

  if (!currentThemes.length) {
    container.innerHTML = '<p class="hint" style="margin:6px 0;font-style:italic;">Добавьте темы обращения выше, чтобы найти похожие кейсы из архива.</p>';
    return;
  }

  const scored = [];
  cases.forEach(c => {
    if (state.loadedCase && state.loadedCase.file && state.loadedCase.file === c.file) return;

    let score = 0;
    const matchedThemes = [];
    const cThemes = Array.isArray(c.themes)
      ? c.themes.map(t => typeof t === "string" ? t : (t.path || t.name || ""))
      : [];

    cThemes.forEach(ct => {
      const ctLower = ct.toLowerCase().trim();
      currentThemes.forEach(cur => {
        if (ctLower === cur) {
          score += 10;
          if (!matchedThemes.includes(ct)) matchedThemes.push(ct);
        } else if (ctLower.includes(cur) || cur.includes(ctLower)) {
          score += 5;
          if (!matchedThemes.includes(ct)) matchedThemes.push(ct);
        } else {
          const seg1 = cur.split(">").pop().trim();
          const seg2 = ctLower.split(">").pop().trim();
          if (seg1 && seg2 && seg1 === seg2 && seg1.length > 3) {
            score += 4;
            if (!matchedThemes.includes(ct)) matchedThemes.push(ct);
          }
        }
      });
    });

    if (currentProblem && (c.problem || (c.digest && c.digest.problem))) {
      const probText = (c.problem || (c.digest && c.digest.problem) || "").toLowerCase();
      const words = currentProblem.split(/\s+/).filter(w => w.length > 4);
      let hits = 0;
      words.forEach(w => {
        if (probText.includes(w)) hits++;
      });
      if (hits > 0) score += Math.min(hits, 3);
    }

    if (score > 0) {
      scored.push({ case: c, score, matchedThemes: matchedThemes.length ? matchedThemes : cThemes.slice(0, 2) });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) {
    container.innerHTML = '<p class="hint" style="margin:6px 0;">По выбранным темам точных совпадений в архиве пока нет.</p>';
    return;
  }

  container.innerHTML = "";
  scored.slice(0, 4).forEach(item => {
    const c = item.case;
    const cardEl = document.createElement("div");
    cardEl.className = "similar-case-card";

    let titleText = (c.title || "").trim();
    if (!titleText) {
      if (c.ticket) titleText = `Тикет #${c.ticket}`;
      else if (c.order) titleText = `Заказ ${c.order}`;
      else titleText = (c.file || "Кейс").replace(".json", "");
    }

    const head = document.createElement("div");
    head.className = "similar-case-head";
    const titleSpan = document.createElement("span");
    titleSpan.className = "similar-case-title";
    titleSpan.textContent = titleText;
    head.appendChild(titleSpan);

    const badges = document.createElement("div");
    badges.style.cssText = "display:flex;align-items:center;gap:6px;";
    if (c.ticket) {
      const tb = document.createElement("span");
      tb.className = "tag";
      tb.style.cssText = "font-size:11.5px;padding:2px 6px;border-radius:4px;border:1px solid var(--line);background:var(--field);font-weight:600;";
      tb.textContent = `#${c.ticket}`;
      badges.appendChild(tb);
    }
    if (c.date) {
      const db = document.createElement("span");
      db.className = "hint";
      db.style.cssText = "font-size:11.5px;margin:0;";
      db.textContent = c.date;
      badges.appendChild(db);
    }
    head.appendChild(badges);
    cardEl.appendChild(head);

    if (item.matchedThemes && item.matchedThemes.length) {
      const tDiv = document.createElement("div");
      tDiv.className = "similar-case-themes";
      item.matchedThemes.forEach(th => {
        const span = document.createElement("span");
        span.className = "similar-theme-tag";
        span.textContent = th;
        tDiv.appendChild(span);
      });
      cardEl.appendChild(tDiv);
    }

    const problem = (c.problem || (c.digest && c.digest.problem) || "").trim();
    if (problem) {
      const pRow = document.createElement("div");
      pRow.className = "similar-case-row";
      pRow.innerHTML = `<strong>Проблема:</strong> `;
      const pTxt = document.createElement("span");
      pTxt.textContent = problem;
      pRow.appendChild(pTxt);
      cardEl.appendChild(pRow);
    }

    const verdict = (c.verdict || (c.digest && c.digest.verdict) || "").trim();
    if (verdict) {
      const vRow = document.createElement("div");
      vRow.className = "similar-case-row";
      vRow.innerHTML = `<strong>Вердикт:</strong> `;
      const vTxt = document.createElement("span");
      vTxt.style.cssText = "font-weight:600;color:var(--ac2);";
      vTxt.textContent = verdict;
      vRow.appendChild(vTxt);
      cardEl.appendChild(vRow);
    }

    const whatWorked = (c.whatWorked || (c.digest && c.digest.whatWorked) || "").trim();
    if (whatWorked) {
      const wRow = document.createElement("div");
      wRow.className = "similar-case-row worked";
      wRow.innerHTML = `<strong>Что сработало:</strong> `;
      const wTxt = document.createElement("span");
      wTxt.textContent = whatWorked;
      wRow.appendChild(wTxt);
      cardEl.appendChild(wRow);
    }

    container.appendChild(cardEl);
  });
}

export function getSimilarDigestForDeepSeek() {
  const currentThemes = (state.themes || []).map(t => (t.path || "").toLowerCase().trim()).filter(Boolean);
  if (!manifestCases || !manifestCases.length) return "";

  const scored = [];
  manifestCases.forEach(c => {
    if (state.loadedCase && state.loadedCase.file && state.loadedCase.file === c.file) return;
    let score = 0;
    const cThemes = Array.isArray(c.themes)
      ? c.themes.map(t => typeof t === "string" ? t : (t.path || t.name || ""))
      : [];

    cThemes.forEach(ct => {
      const ctLower = ct.toLowerCase().trim();
      currentThemes.forEach(cur => {
        if (ctLower === cur || ctLower.includes(cur) || cur.includes(ctLower)) score += 5;
      });
    });

    if (score > 0 || !currentThemes.length) {
      scored.push({ case: c, score });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  const targetCases = (scored.length ? scored.map(s => s.case) : manifestCases).slice(0, 3);

  const lines = [
    "ВЫДЕРЖКА ПОХОЖИХ КЕЙСОВ ИЗ БАЗЫ ЗНАНИЙ:",
    "Обрати внимание на то, как решались аналогичные ситуации ранее и что сработало:\n"
  ];

  targetCases.forEach((c, idx) => {
    let tTitle = (c.title || "").trim();
    if (!tTitle) {
      if (c.ticket) tTitle = `Тикет #${c.ticket}`;
      else if (c.order) tTitle = `Заказ ${c.order}`;
      else tTitle = (c.file || `Кейс ${idx + 1}`).replace(".json", "");
    }

    const tThemes = Array.isArray(c.themes) ? c.themes.join(", ") : (c.themes || "");
    const tProblem = c.problem || (c.digest && c.digest.problem) || "";
    const tVerdict = c.verdict || (c.digest && c.digest.verdict) || "";
    const tWorked = c.whatWorked || (c.digest && c.digest.whatWorked) || "";

    lines.push(`[Кейс ${idx + 1}] «${tTitle}»${c.date ? ` (${c.date})` : ""}`);
    if (tThemes) lines.push(`• Темы: ${tThemes}`);
    if (tProblem) lines.push(`• Суть проблемы: ${tProblem}`);
    if (tVerdict) lines.push(`• Вердикт: ${tVerdict}`);
    if (tWorked) lines.push(`• Что сработало: ${tWorked}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function renderThemes() {
  const ul = $("theme-list");
  if (!ul) return;
  ul.innerHTML = "";

  const countBadge = $("theme-counter-badge");
  if (countBadge) {
    countBadge.textContent = state.themes.length === 0 ? "Тем: 0" : `Тем выбрано: ${state.themes.length}`;
    countBadge.classList.toggle("has-themes", state.themes.length > 0);
  }

  state.themes.forEach((t, i) => {
    const li = document.createElement("li");

    // Номер в кружочке перед каждой предложенной темой
    const numBadge = document.createElement("span");
    numBadge.className = "theme-num-badge";
    numBadge.textContent = String(i + 1);
    numBadge.setAttribute("aria-label", `Тема №${i + 1}`);

    // Кнопки перемещения темы выше/ниже
    const reorderBox = document.createElement("div");
    reorderBox.className = "theme-reorder-btns";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "theme-move-btn";
    upBtn.textContent = "▲";
    upBtn.title = "Переместить тему выше";
    upBtn.setAttribute("aria-label", "Переместить тему выше");
    upBtn.disabled = (i === 0);
    upBtn.addEventListener("click", () => {
      if (i > 0) {
        const temp = state.themes[i];
        state.themes[i] = state.themes[i - 1];
        state.themes[i - 1] = temp;
        save();
        renderThemes();
      }
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "theme-move-btn";
    downBtn.textContent = "▼";
    downBtn.title = "Переместить тему ниже";
    downBtn.setAttribute("aria-label", "Переместить тему ниже");
    downBtn.disabled = (i === state.themes.length - 1);
    downBtn.addEventListener("click", () => {
      if (i < state.themes.length - 1) {
        const temp = state.themes[i];
        state.themes[i] = state.themes[i + 1];
        state.themes[i + 1] = temp;
        save();
        renderThemes();
      }
    });

    reorderBox.append(upBtn, downBtn);

    const body = document.createElement("div");
    body.className = "tbody";

    const name = document.createElement("div");
    name.className = "theme-name-wrap";
    const rawPath = t.path || "";
    const parts = rawPath.split(/\s*>\s*/);
    if (parts.length >= 3) {
      const topRow = document.createElement("div");
      topRow.className = "theme-path-top";
      topRow.textContent = parts.slice(0, 2).join(" > ") + " >";

      const subRow = document.createElement("div");
      subRow.className = "theme-path-sub";
      subRow.textContent = parts.slice(2).join(" > ") + (t.unknown ? " ⚠️ нет в списке" : "");

      name.append(topRow, subRow);
    } else {
      const singleRow = document.createElement("div");
      singleRow.className = "theme-path-top";
      singleRow.textContent = rawPath + (t.unknown ? " ⚠️ нет в списке" : "");
      name.append(singleRow);
    }
    body.append(name);
    if (t.note) body.append(whyPlate(t.note));
    const line = bindLine(TYPE_MAP[norm(t.path)]);
    if (line) body.append(line);

    const st = document.createElement("select");
    st.className = "theme-status-select";
    st.add(new Option("в тикете", "в тикете"));
    st.add(new Option("добавлю я", "добавлю я"));

    const curStatus = (t.status && /тикет/i.test(t.status)) ? "в тикете" : "добавлю я";
    t.status = curStatus;
    st.value = curStatus;
    st.classList.toggle("st-in-ticket", curStatus === "в тикете");
    st.classList.toggle("st-to-add", curStatus === "добавлю я");

    st.addEventListener("change", () => {
      t.status = st.value;
      st.classList.toggle("st-in-ticket", st.value === "в тикете");
      st.classList.toggle("st-to-add", st.value === "добавлю я");
      save();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "x";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Убрать тему");
    del.addEventListener("click", () => {
      state.themes.splice(i, 1);
      save();
      renderThemes();
    });

    li.append(numBadge, reorderBox, body, st, del);
    ul.appendChild(li);
  });
  renderSimilarCases();
}

/* ---------- Инициализация ---------- */
export function initStep2() {
  onRender(2, renderSummary);
  onRender(2, renderThemes);
  onRender(2, renderSimilarCases);

  sels.forEach((s, i) => s.addEventListener("change", () => {
    for (let k = i + 1; k < 3; k++) fillLevel(k);
    $("theme-hint").textContent = picked().comment ? "Подсказка: " + picked().comment : "";
  }));

  $("add-theme").addEventListener("click", () => {
    const path = val("theme-manual") || picked().path;
    if (!path) return;
    const hit = TYPE_MAP[norm(path)];
    if (hit && !hit.leaf) { $("theme-hint").textContent = "Выберите тему до конца: направление, категорию и тему (третий список)."; return; }
    addTheme(path, "добавлю я", "");
    $("theme-manual").value = "";
    sels[0].value = ""; for (let k = 1; k < 3; k++) fillLevel(k);
    $("theme-hint").textContent = "";
    save(); renderThemes();
  });

  // промт step002 (публичный шаблон) подгружается вместе со справочником и правилами из operator-data
  let prompt2Tpl = "";
  const tplReady = fetch("prompts/step002.md", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => { prompt2Tpl = t; })
    .catch(() => {});
  const rulesBlock = () => RULES ? "ПРАВИЛА ВЫБОРА ТЕМ" + (RULES_DATE ? " (инструкция «Правила выбора тем обращений», " + RULES_DATE + ")" : "") + "\n" + RULES : "";

  const buildPrompt2 = () => {
    if (!prompt2Tpl) return "";
    let res = prompt2Tpl;
    if (!TYPE_LINES.length) return res.replace("{{ПРАВИЛА}}", "").replace("{{ТИПЫ}}", "(список тем не загружен)");
    const list = TYPE_LINES.join("\n");
    if (res.includes("{{ПРАВИЛА}}")) return res.replace("{{ПРАВИЛА}}", rulesBlock()).replace("{{ТИПЫ}}", list);
    const head = "СПИСОК ТЕМ (выбирайте только из него; пишите путь целиком, как в списке; значок (DR) входит в название)\n";
    return res.replace("{{ТИПЫ}}", (RULES ? rulesBlock() + "\n\n" : "") + head + list);
  };

  let ready = Promise.resolve();
  const loadAll = () => {
    ready = Promise.all([loadTypes(), loadRules(), tplReady]).then(() => {
      if (prompt2Tpl) $("prompt2-text").textContent = buildPrompt2();
      renderThemes();
    });
    return ready;
  };
  loadAll();
  document.addEventListener("operator:changed", () => {
    resetManifestCache();
    loadAll();
    loadManifestCases().then(renderSimilarCases);
  });

  const copyDigestBtn = $("copy-similar-digest");
  if (copyDigestBtn) {
    copyDigestBtn.addEventListener("click", async () => {
      await loadManifestCases();
      const text = getSimilarDigestForDeepSeek();
      const statusEl = $("similar-copy-status");
      if (!text) {
        if (statusEl) statusEl.textContent = "Нет данных для копирования (архив кейсов пуст).";
        return;
      }
      const ok = await copyText(text);
      if (statusEl) {
        statusEl.textContent = ok ? "Выжимка похожих кейсов скопирована для DeepSeek ✅" : "Не удалось скопировать ⚠️";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3500);
      }
    });
  }

  $("copy-prompt2").addEventListener("click", async () => {
    await ready;
    const st = $("prompt2-state");
    if (!prompt2Tpl) { st.textContent = "Не удалось загрузить prompts/step002.md. Откройте страницу через GitHub Pages."; return; }
    const ok = await copyText(buildPrompt2());
    st.textContent = !ok ? "Не удалось скопировать ⚠️" :
      !TYPE_LINES.length ? "Скопирован без списка тем ⚠️ (справочник не загружен: подключитесь к operator-data)" :
      !RULES ? "Скопирован без правил выбора тем ⚠️ (derived/theme-rules.md не найден)" : "Промт скопирован ✅";
    setTimeout(() => { st.textContent = ""; }, 3500);
  });

  $("parse2").addEventListener("click", () => {
    const msg = $("parse2-msg");
    const res = parseAnswer($("answer2").value, LABELS2);
    if (!res.themes && !Object.keys(res).length) {
      msg.textContent = "Не нашёл метки ТЕМЫ:. Вставьте ответ DeepSeek со списком тем.";
      return;
    }
    let unknown = 0;
    if (res.themes) {
      res.themes.split("\n").forEach(line => {
        const cleanLine = line.replace(/^[\s\-–—•*]*(\[\d+\]|\d+[.)])?\s*[-–—•*]?\s*/, "").trim();
        const parts = cleanLine.split("|").map(x => x.trim());
        if (!parts[0]) return;
        const statusRaw = (parts[1] || "").toLowerCase().trim();
        const status = /тикет/i.test(statusRaw) ? "в тикете" : "добавлю я";
        const note = parts.slice(2).join(" | ").trim();
        addTheme(parts[0], status, note);
      });
      state.themes.forEach(t => { if (t.unknown) unknown++; });
      renderThemes();
      msg.textContent = "Темы добавлены в список." + (unknown ? " Тем вне справочника: " + unknown + " (отмечены ⚠️)." : "");
    }
    const h2 = $("helper2");
    if (h2) h2.open = false;
    save();
  });

  $("next-2").addEventListener("click", () => {
    const err = $("err-2");
    if (!state.themes.length) {
      if (err) err.textContent = "Выберите или добавьте хотя бы одну тему обращения.";
      return;
    }
    if (err) err.textContent = "";
    goTo(3);
  });
}
