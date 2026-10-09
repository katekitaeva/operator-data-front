// Точка входа: подключает шаги и запускает страницу.
// Порядок в конце файла повторяет исходный монолит.

import { FIELDS, CHECKS, STORAGE_KEY } from "./config.js";
import { state, save, load } from "./state.js";
import { $ } from "./ui.js";
import { render, initNav, goTo } from "./nav.js";
import { connSummary, initConnection } from "./github.js";
import { initStep1, loadPrompt, updateClientUrlMsg, currentLocalDatetime, updateHelperVisibility, renderVerdict, resetTicketArchiveCheck } from "./steps/step1.js";
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

/** Полный сброс формы и гарантированный переход к шагу 1 со всеми открытыми помощниками */
export function resetClaimForm() {
  FIELDS.forEach(f => { const el = $(f); if (el) el.value = ""; });
  CHECKS.forEach(c => { const el = $(c); if (el) el.checked = false; });
  ["theme-manual", "t1", "t2", "t3", "helper-ticket", "helper-client-url", "helper-chat"].forEach(id => {
    const el = $(id); if (el) el.value = "";
  });

  // Возврат базовых числовых значений Loyalty
  const bSum = $("c-sum"); if (bSum) bSum.value = "0";
  const bAcc = $("c-acc"); if (bAcc) bAcc.value = "0";
  const bOrders = $("c-orders"); if (bOrders) bOrders.value = "0";
  const bCancels = $("c-cancels"); if (bCancels) bCancels.value = "0";
  const bStatus = $("c-status"); if (bStatus) bStatus.value = "Обычный";
  document.querySelectorAll(".status-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.val === "Обычный");
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

  resetTicketArchiveCheck();

  const matchWarn = $("matching-warnings");
  if (matchWarn) matchWarn.style.display = "none";

  document.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
  ["err-1", "err-2", "parse-msg", "parse2-msg", "parse4-msg", "theme-hint", "ph-note", "client-url-msg"].forEach(id => {
    const el = $(id); if (el) el.textContent = "";
  });

  // Все аккордеоны-помощники DeepSeek на всех шагах обязательно открыты
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
  goTo(1);

  // Все аккордеоны-помощники DeepSeek на всех шагах гарантированно открыты
  document.querySelectorAll("details.helper").forEach(el => {
    el.open = true;
  });
  const h1 = $("helper"); if (h1) h1.open = true;
  const h2 = $("helper2"); if (h2) h2.open = true;
  const h4 = $("helper4"); if (h4) h4.open = true;

  if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
  const s1 = document.getElementById("step-1");
  if (s1 && typeof s1.scrollIntoView === "function") s1.scrollIntoView({ behavior: "smooth" });
}

// Кнопка «Начать новую претензию»: немедленно обновляет форму, открывает помощники и возвращает к шагу 1
function initResetHandler() {
  const resetBtn = $("reset");
  if (!resetBtn) return;

  resetBtn.addEventListener("click", () => {
    resetClaimForm();
  });
}

initResetHandler();

connSummary();
loadPrompt();
load(); renderThemes(); render(); updPh(); updateClientUrlMsg();
