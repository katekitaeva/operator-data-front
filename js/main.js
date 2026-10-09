// Точка входа: подключает шаги и запускает страницу.
// Порядок в конце файла повторяет исходный монолит.

import { FIELDS, CHECKS, STORAGE_KEY } from "./config.js";
import { state, save, load } from "./state.js";
import { $ } from "./ui.js";
import { render, initNav } from "./nav.js";
import { connSummary, initConnection } from "./github.js";
import { initStep1, loadPrompt, updateClientUrlMsg, currentLocalDatetime, updateHelperVisibility, renderVerdict } from "./steps/step1.js";
import { initStep2, renderThemes, renderSummary } from "./steps/step2.js";
import { initStep3 } from "./steps/step3.js";
import { initStep4, updPh, getDefaultActions, renderActionCards, syncChecklistOut } from "./steps/step4.js";
import { initStep5, renderPreview } from "./steps/step5.js";
import { initCaseLoader } from "./case-loader.js";

initNav();
initStep1();
initStep2();
initStep3();
initStep4();
initStep5();
initCaseLoader();
initConnection();

// автосохранение всех полей
FIELDS.forEach(f => {
  const el = $(f);
  if (el) el.addEventListener("input", save);
});

/** Полный сброс формы и возврат к шагу 1 */
export function resetClaimForm() {
  FIELDS.forEach(f => { const el = $(f); if (el) el.value = ""; });
  CHECKS.forEach(c => { const el = $(c); if (el) el.checked = false; });
  ["theme-manual", "t1", "t2", "t3", "helper-ticket", "helper-client-url", "helper-chat"].forEach(id => {
    const el = $(id); if (el) el.value = "";
  });

  const nowDt = currentLocalDatetime();
  const dtEl = $("case-datetime");
  const helperDtEl = $("helper-datetime");
  if (dtEl) dtEl.value = nowDt;
  if (helperDtEl) helperDtEl.value = nowDt;

  state.current = 1;
  state.themes = [];
  state.actions = getDefaultActions();
  state.caseMatch = null;
  state.caseSaved = false;
  state.loadedCase = null;
  state.matchingText = "";
  state.dictionaryVersion = null;
  const matchWarn = $("matching-warnings");
  if (matchWarn) matchWarn.style.display = "none";

  document.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
  ["err-1", "err-2", "parse-msg", "parse2-msg", "parse4-msg", "theme-hint", "ph-note", "client-url-msg"].forEach(id => {
    const el = $(id); if (el) el.textContent = "";
  });

  // Все аккордеоны-помощники DeepSeek на всех шагах открываем по умолчанию
  ["helper", "helper2", "helper4"].forEach(id => {
    const el = $(id);
    if (el) el.open = true;
  });

  const saveMsg = $("save-case-msg");
  if (saveMsg) { saveMsg.textContent = ""; saveMsg.className = "hint msg"; }

  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  save();

  renderThemes();
  renderActionCards();
  syncChecklistOut();
  renderSummary();
  renderVerdict();
  updPh();
  updateClientUrlMsg();
  renderPreview();
  render();

  if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
  const s1 = document.getElementById("step-1");
  if (s1 && typeof s1.scrollIntoView === "function") s1.scrollIntoView({ behavior: "smooth" });
}

// Обработка кнопки «Начать новую претензию» через встроенное модальное окно (без блокирующего window.confirm)
function initResetHandler() {
  const resetBtn = $("reset");
  const modal = $("reset-confirm-modal");
  const closeBtn = $("reset-modal-close");
  const cancelBtn = $("reset-modal-cancel");
  const confirmBtn = $("reset-modal-confirm");
  const warnEl = $("reset-modal-warning");

  if (!resetBtn) return;

  const closeModal = () => { if (modal) modal.hidden = true; };

  const openModal = () => {
    const hasContent = ["ticket", "order", "problem", "demand", "what-worked", "case-title"].some(id => $(id) && $(id).value.trim()) ||
      (state.themes && state.themes.length > 0) ||
      !!state.loadedCase;

    // Если форма пустая, сразу переходим на чистый шаг 1 без лишних вопросов
    if (!hasContent) {
      resetClaimForm();
      return;
    }

    if (modal) {
      if (warnEl) warnEl.hidden = !!state.caseSaved;
      modal.hidden = false;
      if (confirmBtn) confirmBtn.focus();
    } else {
      resetClaimForm();
    }
  };

  resetBtn.addEventListener("click", (e) => {
    if (e.shiftKey) { resetClaimForm(); return; }
    openModal();
  });

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      closeModal();
      resetClaimForm();
    });
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeModal();
  });
}

initResetHandler();

connSummary();
loadPrompt();
load(); renderThemes(); render(); updPh(); updateClientUrlMsg();
