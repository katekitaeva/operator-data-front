// Загрузка сохранённого кейса через модальное окно

import { $ } from "./ui.js";
import { conn, ghGet } from "./github.js";
import { loadCaseIntoForm } from "./cases.js";
import { renderThemes, renderSummary } from "./steps/step2.js";
import { renderVerdict } from "./steps/step1.js";
import { renderPreview } from "./steps/step5.js";
import { updateClientUrlMsg } from "./steps/step1.js";
import { updPh, syncChecklistOut } from "./steps/step4.js";
import { render, goTo } from "./nav.js";

let casesList = [];

/** Получение списка кейсов из архива (с кэшированием) */
export async function getArchiveCases(forceReload = false) {
  if (casesList.length > 0 && !forceReload) return casesList;
  const c = conn();
  if (!c || !c.token) return [];
  try {
    const raw = await ghGet("cases/manifest.json");
    const data = JSON.parse(raw);
    casesList = data.cases || [];
    return casesList;
  } catch (e) {
    console.warn("Could not load archive cases:", e);
    // При явном открытии окна пробрасываем ошибку, чтобы оператор видел причину, а не «кейсов нет»
    if (forceReload) throw e;
    return [];
  }
}

/** Загрузка кейса по имени файла в форму с перерисовкой всех шагов */
export async function loadCaseByFile(fileName, targetStep = null) {
  const rawFile = await ghGet(`cases/${fileName}`);
  const fullCard = JSON.parse(rawFile);
  loadCaseIntoForm(fullCard, fileName);
  renderSummary();
  renderThemes();
  renderVerdict();
  syncChecklistOut();
  updPh();
  updateClientUrlMsg();
  render();
  renderPreview();
  if (targetStep) {
    goTo(targetStep);
  }
  return fullCard;
}

export function initCaseLoader() {
  const btn = $("load-case-btn");
  const modal = $("case-modal");
  const closeBtn = $("modal-close");
  const searchInput = $("modal-search");
  const listEl = $("modal-case-list");

  if (!btn || !modal) return;

  const closeModal = () => { modal.hidden = true; };
  const openModal = async () => {
    modal.hidden = false;
    if (searchInput) searchInput.value = "";
    listEl.innerHTML = '<li class="hint" style="padding:10px;">Загружаю архив кейсов…</li>';
    const c = conn();
    if (!c || !c.token) {
      listEl.innerHTML = '<li class="hint er" style="padding:10px;color:var(--er);">Сначала подключитесь к operator-data через шестерёнку (⚙) вверху страницы.</li>';
      return;
    }
    try {
      casesList = await getArchiveCases(true);
      renderModalList();
    } catch (e) {
      listEl.innerHTML = `<li class="hint" style="padding:10px;line-height:1.4;">Не удалось прочитать cases/manifest.json (${e.message}). Убедитесь, что архив кейсов инициализирован в репозитории.</li>`;
    }
  };

  function renderModalList() {
    const q = (searchInput.value || "").toLowerCase().trim();
    const filtered = casesList.filter(c => {
      if (!q) return true;
      const hay = [
        c.ticket || "",
        c.order || "",
        c.title || "",
        c.problem || (c.digest && c.digest.problem) || "",
        c.verdict || (c.digest && c.digest.verdict) || "",
        c.whatWorked || (c.digest && c.digest.whatWorked) || "",
        ...(c.themes || (c.digest && c.digest.themes) || []).map(t => typeof t === "string" ? t : (t.path || t.name || ""))
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });

    if (!filtered.length) {
      listEl.innerHTML = '<li class="hint" style="padding:10px;">Кейсов по вашему запросу не найдено.</li>';
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach(c => {
      const li = document.createElement("li");
      li.className = "modal-item";
      li.style.cssText = "padding:10px 14px;cursor:pointer;";

      // Формируем понятное название кейса (заголовок, либо тикет, либо заказ, либо имя файла)
      let caseName = (c.title || "").trim();
      if (!caseName) {
        if (c.ticket) caseName = `Тикет #${c.ticket}`;
        else if (c.order) caseName = `Заказ ${c.order}`;
        else if (c.file) caseName = c.file.replace(/\.json$/i, "");
        else caseName = "Кейс без названия";
      }

      const topRow = document.createElement("div");
      topRow.className = "modal-item-top";
      topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;";

      const nameSpan = document.createElement("span");
      nameSpan.style.cssText = "font-weight:600;font-size:14px;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameSpan.textContent = caseName;
      nameSpan.title = caseName;
      topRow.appendChild(nameSpan);

      const metaBox = document.createElement("div");
      metaBox.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

      if (c.title && c.ticket) {
        const ticketBadge = document.createElement("span");
        ticketBadge.className = "tag";
        ticketBadge.style.cssText = "font-weight:600;color:var(--ink);padding:2px 7px;border-radius:4px;background:var(--card);border:1px solid var(--line);font-size:12px;";
        ticketBadge.textContent = `#${c.ticket}`;
        metaBox.appendChild(ticketBadge);
      } else if (c.title && c.order) {
        const orderBadge = document.createElement("span");
        orderBadge.className = "tag";
        orderBadge.style.cssText = "font-weight:600;color:var(--ink);padding:2px 7px;border-radius:4px;background:var(--card);border:1px solid var(--line);font-size:12px;";
        orderBadge.textContent = `заказ ${c.order}`;
        metaBox.appendChild(orderBadge);
      }

      if (c.date) {
        const dateSpan = document.createElement("span");
        dateSpan.className = "hint";
        dateSpan.style.cssText = "font-size:12px;color:var(--soft);";
        dateSpan.textContent = c.date;
        metaBox.appendChild(dateSpan);
      }

      topRow.appendChild(metaBox);
      li.appendChild(topRow);

      li.addEventListener("click", async () => {
        closeModal();
        let fullCard = c;
        if (c.file) {
          try {
            const rawFile = await ghGet(`cases/${c.file}`);
            fullCard = { ...c, ...JSON.parse(rawFile) };
          } catch (err) {
            console.warn("Could not fetch full card from file, using manifest item:", err);
          }
        }
        loadCaseIntoForm(fullCard, c.file);
        renderSummary();
        renderThemes();
        renderVerdict();
        syncChecklistOut();
        updPh();
        updateClientUrlMsg();
        render();
        renderPreview();
        goTo(5);
      });

      listEl.appendChild(li);
    });
  }

  btn.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  if (searchInput) {
    searchInput.addEventListener("input", renderModalList);
  }
}
