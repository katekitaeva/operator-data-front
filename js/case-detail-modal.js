// Модальное окно подробного просмотра кейса из базы знаний
import { $, copyText } from "./ui.js";
import { ticketUrl, orderUrl } from "./crm.js";
import { conn, ghGet } from "./github.js";
import { state } from "./state.js";
import { loadCaseByFile } from "./case-loader.js";

let currentActiveCase = null;
let currentFullCard = null;

/** Инициализация модального окна просмотра кейса */
export function initCaseDetailModal() {
  const modal = $("case-detail-modal");
  const closeBtn = $("case-detail-close");
  const cancelBtn = $("case-detail-cancel-btn");
  const copyBtn = $("case-detail-copy-btn");
  const loadBtn = $("case-detail-load-btn");

  if (!modal) return;

  const closeModal = () => {
    modal.hidden = true;
    currentActiveCase = null;
    currentFullCard = null;
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const card = currentFullCard || currentActiveCase;
      if (!card) return;
      const text = formatCaseMarkdown(card);
      const ok = await copyText(text);
      const st = $("case-detail-copy-status");
      if (st) {
        st.textContent = ok ? "Скопировано в буфер ✅" : "Не удалось скопировать ⚠️";
        setTimeout(() => { if (st) st.textContent = ""; }, 3000);
      }
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      const card = currentFullCard || currentActiveCase;
      if (!card || !card.file) {
        alert("Имя файла кейса не найдено в манифесте.");
        return;
      }

      // Проверяем наличие несохраненных данных в форме
      const hasWorkInProgress = state.themes.length > 0 ||
        (document.getElementById("problem") && document.getElementById("problem").value.trim().length > 0) ||
        (document.getElementById("ticket") && document.getElementById("ticket").value.trim().length > 0);

      if (hasWorkInProgress) {
        const confirmed = window.confirm("Загрузить этот кейс в форму?\n\nВнимание: текущие данные черновика будут заменены информацией выбранного кейса.");
        if (!confirmed) return;
      }

      closeModal();
      try {
        await loadCaseByFile(card.file, 2);
      } catch (err) {
        console.error("Ошибка при загрузке кейса:", err);
      }
    });
  }
}

/** Открытие модального окна с деталями кейса */
export async function openCaseDetailModal(caseObj) {
  const modal = $("case-detail-modal");
  if (!modal) return;

  currentActiveCase = caseObj;
  currentFullCard = null;

  const titleEl = $("case-detail-title");
  const badgeEl = $("case-detail-badge");
  const bodyEl = $("case-detail-body");
  const copyStatusEl = $("case-detail-copy-status");

  if (copyStatusEl) copyStatusEl.textContent = "";

  let caseTitle = (caseObj.title || "").trim();
  if (!caseTitle) {
    if (caseObj.ticket) caseTitle = `Тикет #${caseObj.ticket}`;
    else if (caseObj.order) caseTitle = `Заказ ${caseObj.order}`;
    else caseTitle = (caseObj.file || "Кейс").replace(/\.json$/i, "");
  }

  if (titleEl) titleEl.textContent = caseTitle;

  if (badgeEl) {
    if (caseObj.ticket) {
      badgeEl.textContent = `#${caseObj.ticket}`;
      badgeEl.style.display = "inline-block";
    } else if (caseObj.order) {
      badgeEl.textContent = `Заказ ${caseObj.order}`;
      badgeEl.style.display = "inline-block";
    } else {
      badgeEl.style.display = "none";
    }
  }

  // Рендерим базовые данные из манифеста
  renderCaseDetailBody(caseObj, false);
  modal.hidden = false;

  // Если кейс имеет файл в репозитории и есть подключение к GitHub, подгружаем полный JSON
  if (caseObj.file && conn() && conn().token) {
    try {
      let rawFile = null;
      try {
        rawFile = await ghGet(`cases/${caseObj.file}`);
      } catch (e) {
        rawFile = await ghGet(`inbox/cases/${caseObj.file}`);
      }
      if (rawFile) {
        const fullData = JSON.parse(rawFile);
        currentFullCard = { ...caseObj, ...fullData };
        renderCaseDetailBody(currentFullCard, true);
      }
    } catch (err) {
      console.warn("Could not load full case JSON, keeping manifest view:", err);
    }
  }
}

/** Рендеринг содержимого модального окна */
function renderCaseDetailBody(c, isFull = false) {
  const body = $("case-detail-body");
  if (!body) return;
  body.innerHTML = "";

  const container = document.createElement("div");
  container.className = "case-detail-wrapper";

  // 1. Сетка метаданных (Тикет, Заказ, Дата, Клиент)
  const metaGrid = document.createElement("div");
  metaGrid.className = "case-detail-grid";

  if (c.ticket) {
    metaGrid.appendChild(createMetaItem("Тикет CRM", `#${c.ticket}`, ticketUrl(c.ticket)));
  }
  if (c.order) {
    metaGrid.appendChild(createMetaItem("Заказ", c.order, orderUrl(c.order)));
  }
  if (c.date || c.caseDatetime) {
    const dt = c.caseDatetime ? c.caseDatetime.replace("T", " ") : c.date;
    metaGrid.appendChild(createMetaItem("Дата фиксации", dt));
  }
  if (c.clientContext && c.clientContext.clientStatus) {
    metaGrid.appendChild(createMetaItem("Статус клиента", c.clientContext.clientStatus));
  }
  if (metaGrid.children.length > 0) {
    container.appendChild(metaGrid);
  }

  // 2. Темы обращения
  const themes = Array.isArray(c.themes) ? c.themes : (c.digest && c.digest.themes) || [];
  if (themes.length > 0) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Темы обращения</div>`;
    const themeTags = document.createElement("div");
    themeTags.className = "case-detail-themes-box";
    themes.forEach(t => {
      const tag = document.createElement("div");
      tag.className = "case-detail-theme-item";
      const pathText = typeof t === "string" ? t : (t.path || t.name || "");
      const noteText = typeof t === "object" && t.note ? t.note : "";
      const statusText = typeof t === "object" && t.status ? t.status : "";

      tag.innerHTML = `<span class="case-detail-theme-path">${escapeHtml(pathText)}</span>` +
        (statusText ? `<span class="case-detail-theme-st">${escapeHtml(statusText)}</span>` : "") +
        (noteText ? `<div class="case-detail-theme-note">${escapeHtml(noteText)}</div>` : "");
      themeTags.appendChild(tag);
    });
    sec.appendChild(themeTags);
    container.appendChild(sec);
  }

  // 3. Суть проблемы
  const problem = (c.problem || (c.digest && c.digest.problem) || "").trim();
  if (problem) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Суть проблемы</div>`;
    const pBox = document.createElement("div");
    pBox.className = "case-detail-box case-detail-problem-box";
    pBox.textContent = problem;
    sec.appendChild(pBox);
    container.appendChild(sec);
  }

  // 4. Требование клиента
  const demand = (c.demand || "").trim();
  if (demand) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Требование клиента</div>`;
    const dBox = document.createElement("div");
    dBox.className = "case-detail-box";
    dBox.textContent = demand;
    sec.appendChild(dBox);
    container.appendChild(sec);
  }

  // 5. Вердикт
  const verdict = (c.verdict || (c.digest && c.digest.verdict) || "").trim();
  if (verdict) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Вердикт и обоснование</div>`;
    const vBox = document.createElement("div");
    vBox.className = "case-detail-box case-detail-verdict-box";
    vBox.textContent = verdict;
    sec.appendChild(vBox);
    container.appendChild(sec);
  }

  // 6. Что сработало (выделенный зеленый акцент)
  const whatWorked = (c.whatWorked || (c.digest && c.digest.whatWorked) || "").trim();
  if (whatWorked) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    const wBox = document.createElement("div");
    wBox.className = "case-detail-worked-box";
    wBox.innerHTML = `
      <div class="case-detail-worked-head">
        <svg class="i" aria-hidden="true" focusable="false" style="color:var(--good);"><use href="assets/icons.svg#i-spark"/></svg>
        <strong>Что сработало в этом кейсе (опыт коллег)</strong>
      </div>
      <div class="case-detail-worked-text">${escapeHtml(whatWorked)}</div>
    `;
    sec.appendChild(wBox);
    container.appendChild(sec);
  }

  // 7. Выполненные действия (чеклист)
  if (Array.isArray(c.actions) && c.actions.length > 0) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Выполненные действия (чек-лист)</div>`;
    const aList = document.createElement("div");
    aList.className = "case-detail-actions-list";
    c.actions.forEach((act, idx) => {
      const aItem = document.createElement("div");
      aItem.className = `case-detail-action-item ${act.done ? "action-done" : ""}`;
      const title = act.title || `Действие №${idx + 1}`;
      let contentSnippet = act.script || act.text || act.commentText || act.customText || "";
      if (act.points) contentSnippet = `Баллы: ${act.points} (${act.reason || ""})` + (contentSnippet ? ` • ${contentSnippet}` : "");

      aItem.innerHTML = `
        <div class="case-detail-action-head">
          <span class="case-detail-action-num">${idx + 1}</span>
          <span class="case-detail-action-title">${escapeHtml(title)}</span>
          ${act.done ? '<span class="tag" style="background:rgba(28,138,99,0.12);color:var(--good);font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;">Выполнено</span>' : ""}
        </div>
        ${contentSnippet ? `<div class="case-detail-action-snippet">${escapeHtml(contentSnippet)}</div>` : ""}
      `;
      aList.appendChild(aItem);
    });
    sec.appendChild(aList);
    container.appendChild(sec);
  }

  // 8. Сопоставление (matching)
  if (c.matching && typeof c.matching === "object" && Object.keys(c.matching).length > 0) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Сопоставление с правилами (matching)</div>`;
    const mBox = document.createElement("div");
    mBox.className = "case-detail-matching-grid";
    for (const [key, val] of Object.entries(c.matching)) {
      if (val !== undefined && val !== null && val !== "") {
        const row = document.createElement("div");
        row.className = "case-detail-matching-row";
        row.innerHTML = `<span class="matching-key">${escapeHtml(key)}:</span> <span class="matching-val">${escapeHtml(String(val))}</span>`;
        mBox.appendChild(row);
      }
    }
    sec.appendChild(mBox);
    container.appendChild(sec);
  }

  // 9. Заметки контроля качества
  const qc = (c.qcComments || "").trim();
  if (qc) {
    const sec = document.createElement("div");
    sec.className = "case-detail-sec";
    sec.innerHTML = `<div class="case-detail-sec-title">Заметки контроля качества</div>`;
    const qcBox = document.createElement("div");
    qcBox.className = "case-detail-box";
    qcBox.textContent = qc;
    sec.appendChild(qcBox);
    container.appendChild(sec);
  }

  // Индикатор загрузки полного файла
  if (!isFull && c.file && conn() && conn().token) {
    const loadNotice = document.createElement("p");
    loadNotice.className = "hint";
    loadNotice.style.cssText = "font-size:12px;text-align:center;margin-top:12px;";
    loadNotice.textContent = "Подгружаются полные данные из репозитория…";
    container.appendChild(loadNotice);
  }

  body.appendChild(container);
}

function createMetaItem(label, text, url = null) {
  const item = document.createElement("div");
  item.className = "case-detail-meta-item";
  const lbl = document.createElement("span");
  lbl.className = "meta-item-label";
  lbl.textContent = label;
  item.appendChild(lbl);

  const valEl = document.createElement("div");
  valEl.className = "meta-item-value";
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    a.style.cssText = "color:var(--ac);text-decoration:none;font-weight:600;";
    valEl.appendChild(a);
  } else {
    valEl.textContent = text;
  }
  item.appendChild(valEl);
  return item;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Форматирование данных кейса в структурированный текст для буфера обмена */
export function formatCaseMarkdown(c) {
  const lines = [];
  let title = (c.title || "").trim();
  if (!title) {
    if (c.ticket) title = `Тикет #${c.ticket}`;
    else if (c.order) title = `Заказ ${c.order}`;
    else title = (c.file || "Кейс").replace(/\.json$/i, "");
  }

  lines.push(`КЕЙС: «${title}»`);
  if (c.date) lines.push(`Дата: ${c.date}`);
  if (c.ticket) lines.push(`Тикет: #${c.ticket}`);
  if (c.order) lines.push(`Заказ: ${c.order}`);

  const themes = Array.isArray(c.themes)
    ? c.themes.map(t => typeof t === "string" ? t : (t.path || t.name || "")).join(", ")
    : (c.digest && c.digest.themes ? c.digest.themes.join(", ") : "");
  if (themes) lines.push(`Темы: ${themes}`);

  const problem = c.problem || (c.digest && c.digest.problem);
  if (problem) lines.push(`\nСуть проблемы:\n${problem}`);

  const demand = c.demand;
  if (demand) lines.push(`\nТребование клиента:\n${demand}`);

  const verdict = c.verdict || (c.digest && c.digest.verdict);
  if (verdict) lines.push(`\nВердикт:\n${verdict}`);

  const whatWorked = c.whatWorked || (c.digest && c.digest.whatWorked);
  if (whatWorked) lines.push(`\nЧто сработало:\n${whatWorked}`);

  if (Array.isArray(c.actions) && c.actions.length > 0) {
    lines.push(`\nДействия:`);
    c.actions.forEach((a, i) => {
      const actTitle = a.title || `Действие ${i + 1}`;
      lines.push(`${i + 1}. [${actTitle}] ${a.script || a.text || a.commentText || ""}`);
    });
  }

  return lines.join("\n").trim();
}
