// Навигация между шагами: прогресс-кнопки, переключение шагов, CRM-меню.
// Шаги подписываются на отрисовку через onRender(), чтобы nav не импортировал шаги.

import { TOTAL, STEP_COUNT } from "./config.js";
import { state, save } from "./state.js";
import { updateCrmBar } from "./crm.js";

const STEP_LABELS = [
  "Суть",
  "Темы",
  "Правила",
  "Действия",
  "Запись"
];

const renderHooks = [];
/** fn вызывается в render(), когда текущий шаг >= minStep */
export function onRender(minStep, fn) { renderHooks.push([minStep, fn]); }

export function renderProgress() {
  const nav = document.getElementById("step-nav") || document.getElementById("progress");
  if (!nav) return;
  nav.innerHTML = "";
  for (let i = 1; i <= TOTAL; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "step-nav-btn";
    btn.dataset.step = String(i);
    if (i === state.current) btn.classList.add("active");
    else if (i < state.current) btn.classList.add("done");

    const numSpan = document.createElement("span");
    numSpan.className = "step-nav-num";
    numSpan.textContent = String(i);

    const labelSpan = document.createElement("span");
    labelSpan.className = "step-nav-text";
    labelSpan.textContent = STEP_LABELS[i - 1] || ("Шаг " + i);

    btn.append(numSpan, labelSpan);

    if (i === 3) {
      const wipSpan = document.createElement("span");
      wipSpan.className = "step-nav-wip-badge";
      wipSpan.textContent = "WIP";
      wipSpan.title = "В разработке";
      btn.append(wipSpan);
    }
    btn.addEventListener("click", () => goTo(i));
    nav.appendChild(btn);
  }
}

export function render() {
  renderProgress();
  for (let n = 1; n <= STEP_COUNT; n++) {
    const el = document.getElementById("step-" + n);
    if (el) {
      el.hidden = n !== state.current;
    }
  }
  updateCrmBar();
  renderHooks.forEach(([min, fn]) => { if (state.current >= min) fn(); });
}

export function goTo(n) {
  state.current = n; save(); render();
  const target = document.getElementById("step-" + n);
  if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth" });
}

export function initNav() {
  // клик по заголовку пройденного шага возвращает к нему
  document.querySelectorAll(".linkbtn").forEach(b => b.addEventListener("click", () => {
    const n = +b.dataset.n;
    if (n) goTo(n);
  }));

  // Живое обновление CRM-меню при вводе ключевых полей
  ["ticket", "order", "client-url"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateCrmBar);
      el.addEventListener("change", updateCrmBar);
    }
  });
}
