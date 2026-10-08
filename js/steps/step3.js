// Шаг 3. Инструкции & правила: подбор страниц инструкций Loyalty из кэша operator-data,
// проверка правил и подготовка к формированию чек-листа действий.

import { $, val } from "../ui.js";
import { MEMO_URL, DOCS } from "../config.js";
import { tabUrls } from "../crm.js";
import { state, save } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { verdict, renderVerdict } from "./step1.js";
export { verdict, renderVerdict };

function renderTabs() {
  const box = $("tablinks");
  if (!box) return;
  const urls = tabUrls();
  box.textContent = "";
  if (!urls) {
    box.textContent = "Вставьте адрес карточки клиента на шаге 1, чтобы здесь появились прямые ссылки на CRM.";
    return;
  }
  box.append("Вкладки карточки клиента: ");
  urls.forEach(([name, href], i) => {
    if (i) box.append(" · ");
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = name;
    box.append(a);
  });
}

function renderCaseReview() {
  const tBox = $("step3-themes");
  if (tBox) {
    tBox.innerHTML = "";
    if (state.themes && state.themes.length) {
      state.themes.forEach(t => {
        const tag = document.createElement("span");
        tag.className = "similar-theme-tag";
        tag.style.marginRight = "6px";
        tag.textContent = t.path;
        tBox.appendChild(tag);
      });
    } else {
      tBox.textContent = "Темы обращения не выбраны (вернитесь на шаг 2).";
    }
  }

  const vBox = $("step3-verdict");
  if (vBox) {
    vBox.textContent = verdict();
  }
}

export function initStep3() {
  const memo = $("step3-memo-link");
  if (memo) memo.href = MEMO_URL;

  onRender(3, () => {
    renderTabs();
    renderCaseReview();
  });

  $("next-3")?.addEventListener("click", () => goTo(4));
}
