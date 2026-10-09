// Шаг 5. Запись кейса: предпросмотр карточки, ввод заголовка, «что сработало» и QC-комментариев

import { $, val } from "../ui.js";
import { state, save } from "../state.js";
import { onRender } from "../nav.js";
import { conn } from "../github.js";
import { buildCaseCard, saveCaseCard } from "../cases.js";

export function renderPreview() {
  const box = $("case-preview");
  if (!box) return;
  box.textContent = "";

  const card = buildCaseCard();
  const isUpdate = !!(state.loadedCase && state.loadedCase.file);

  const wrap = document.createElement("div");
  wrap.className = "case-preview-card";

  if (isUpdate) {
    const banner = document.createElement("div");
    banner.className = "loaded-case-badge";
    banner.innerHTML = `<span>✏️ Режим обновления: редактируется кейс <strong>${state.loadedCase.id}</strong> (файл: ${state.loadedCase.file})</span>`;
    wrap.appendChild(banner);
  }

  const head = document.createElement("div");
  head.className = "case-preview-head";
  const titleDisplay = card.title ? `«${card.title}»` : (card.ticket ? "Тикет #" + card.ticket : "Заказ " + (card.order || "без номера"));
  head.innerHTML = `<strong>Кейс: ${titleDisplay}</strong> · <span class="hint">${card.date}${card.isUpdated ? " (обновление)" : ""}</span>`;
  wrap.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "case-preview-grid";

  const rows = [
    ["Заголовок", card.title || "—"],
    ["Тикет", card.ticket || "—"],
    ["Заказ", card.order || "—"],
    ["ID клиента", card.clientId || "не определён (нет в ссылке CRM)"],
    ["Темы", card.themes.length ? card.themes.map((t, i) => `${i + 1}. ${t.path} <strong>[${t.status}]</strong>`).join("<br>") : "не выбраны"],
    ["Суть проблемы", card.problem || "—"],
    ["Требование", card.demand || "—"],
    ["Вердикт Памятки", card.verdict ? card.verdict.split("\n")[0] : "—"]
  ];

  if (Array.isArray(card.actions) && card.actions.length > 0) {
    const totalActs = card.actions.length;
    const doneActs = card.actions.filter(a => a.done).length;
    const actsList = card.actions.map((a, i) => {
      const mark = a.done ? "✅" : "⏳";
      let extra = "";
      if (a.type === "call" && a.time) extra = ` (${a.time})`;
      else if (a.type === "compensation" && a.points) extra = ` (${a.points} ${a.compType || "баллов"})`;
      else if (a.type === "task" && a.target) extra = ` (кому: ${a.target})`;
      return `${i + 1}. ${mark} <strong>${a.title}</strong>${extra}`;
    }).join("<br>");
    rows.push([`Действия чеклиста (${doneActs}/${totalActs})`, actsList]);
  } else if (card.outcome && card.outcome.check) {
    rows.push(["Чек-лист исполнения", card.outcome.check.replace(/\n/g, "<br>")]);
  }

  if (card.outcome && card.outcome.reply) {
    rows.push(["Ответ клиенту", card.outcome.reply.replace(/\n/g, "<br>")]);
  }
  if (card.outcome && card.outcome.comment) {
    rows.push(["Комментарий в тикет", card.outcome.comment.replace(/\n/g, "<br>")]);
  }

  if (card.matching && typeof card.matching === "object" && Object.keys(card.matching).length > 0) {
    const vBadge = card.dictionaryVersion ? ` [словарь v${card.dictionaryVersion}]` : "";
    const mLines = Object.entries(card.matching).map(([k, v]) => `<strong>${k}</strong>: ${v}`).join("<br>");
    rows.push([`Сопоставление кейсов (matching)${vBadge}`, mLines]);
  } else if (card.problemMatch || card.solution) {
    rows.push([
      "Сопоставление со справочником (старое)",
      `Проблема: <strong>${card.problemMatch || "—"}</strong><br>Требование: <strong>${card.demandMatch || "—"}</strong><br>Решение: <strong>${card.solution || "—"}</strong><br>Результат: <strong>${card.result || "—"}</strong><br>Баллы: <strong>${card.points !== null ? card.points : "—"}</strong><br>Причины: <strong>${card.reasons || "—"}</strong>`
    ]);
  }

  rows.push(["Что сработало", card.whatWorked || "—"]);
  rows.push(["Комментарии QC", card.qcComments || "—"]);

  rows.forEach(([k, v]) => {
    const r = document.createElement("div");
    r.className = "srow";
    r.innerHTML = `<span class="slabel">${k}</span><div>${v}</div>`;
    grid.appendChild(r);
  });
  wrap.appendChild(grid);

  // Сворачиваемый просмотр полного JSON
  const det = document.createElement("details");
  det.className = "inner";
  det.style.marginTop = "12px";
  const sum = document.createElement("summary");
  sum.textContent = "Показать полный обезличенный JSON карточки";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(card, null, 2);
  det.append(sum, pre);
  wrap.appendChild(det);

  box.appendChild(wrap);

  // Обновляем текст кнопки сохранения в зависимости от режима
  const btn = $("save-case-btn");
  if (btn) {
    const btnLabel = isUpdate ? "Обновить кейс в operator-data" : "Записать кейс в operator-data";
    btn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-spark"/></svg>${btnLabel}`;
  }
}

export function initStep5() {
  onRender(5, renderPreview);

  ["case-title", "what-worked", "qc-comments"].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener("input", () => {
        save();
        renderPreview();
      });
    }
  });

  const btn = $("save-case-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const msg = $("save-case-msg");
    const c = conn();
    if (!c || !c.token) {
      msg.className = "hint msg er";
      msg.textContent = "Нет подключения к operator-data: откройте настройки (⚙) и введите токен с правами Contents: Read and write.";
      return;
    }

    const ticket = val("ticket").trim();
    const order = val("order").trim();
    const problem = val("problem").trim();
    const demand = val("demand").trim();

    if (!ticket && !order) {
      msg.className = "hint msg er";
      msg.textContent = "Заполните номер тикета или заказа (на шаге 1).";
      return;
    }
    if (!problem || !demand) {
      msg.className = "hint msg er";
      msg.textContent = "Заполните суть проблемы и требование клиента (на шаге 1).";
      return;
    }

    const isUpdate = !!(state.loadedCase && state.loadedCase.file);
    btn.disabled = true;
    msg.className = "hint msg";
    msg.textContent = isUpdate ? "Обновление карточки кейса в архиве…" : "Подготовка и отправка карточки кейса в inbox/cases/…";

    try {
      const card = buildCaseCard();
      const res = await saveCaseCard(card);
      state.caseSaved = true;
      save();
      renderPreview();
      msg.className = "hint msg ok";
      msg.textContent = res.isUpdate
        ? `Готово! Карточка кейса обновлена в ${res.path}.`
        : `Готово! Новая карточка записана в ${res.path}. В репозитории запустится обработка для переноса в архив.`;
    } catch (e) {
      msg.className = "hint msg er";
      msg.textContent = `Не удалось сохранить кейс: ${e.message}. Проверьте права токена (нужны Contents: Read and write).`;
    } finally {
      btn.disabled = false;
    }
  });
}
