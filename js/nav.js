// Навигация между шагами: прогресс, показ/сворачивание секций, переход.
// Шаги подписываются на отрисовку через onRender(), чтобы nav не импортировал шаги.

import { TOTAL, STEP_COUNT } from "./config.js";
import { state, save } from "./state.js";
import { updateCrmBar } from "./crm.js";

const renderHooks = [];
/** fn вызывается в render(), когда текущий шаг >= minStep */
export function onRender(minStep, fn) { renderHooks.push([minStep, fn]); }

export function renderProgress() {
  const bar = document.getElementById("progress");
  if (!bar) return;
  bar.innerHTML = "";
  for (let i = 1; i <= TOTAL; i++) {
    const s = document.createElement("span");
    if (i < state.current) s.className = "done";
    else if (i === state.current) s.className = "on";
    bar.appendChild(s);
  }
}

export function render() {
  renderProgress();
  for (let n = 1; n <= STEP_COUNT; n++) {
    const el = document.getElementById("step-" + n);
    if (el) {
      el.hidden = n > state.current;
      el.classList.toggle("collapsed", n < state.current);
    }
  }
  updateCrmBar();
  renderHooks.forEach(([min, fn]) => { if (state.current >= min) fn(); });
}

export function goTo(n) {
  state.current = n; save(); render();
  const target = document.getElementById("step-" + n);
  if (target) target.scrollIntoView({ behavior: "smooth" });
}

export function initNav() {
  // клик по заголовку пройденного шага возвращает к нему
  document.querySelectorAll(".linkbtn").forEach(b => b.addEventListener("click", () => {
    const n = +b.dataset.n;
    if (state.current > n) goTo(n);
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
