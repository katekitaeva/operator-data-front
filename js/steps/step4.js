// Шаг 4. Решение и тексты: сборка промта (факты + вердикт + страницы инструкций из operator-data),
// карточки действий чек-листа исполнения, разбор ответа DeepSeek.

import { $, val, copyText } from "../ui.js";
import { state, save } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { DOCS } from "../config.js";
import { ghGet } from "../github.js";
import { verdict } from "./step1.js";
import { parseAnswer, LABELS4 } from "../parser.js";

const factsText = () => [
  "Суть проблемы: " + val("problem"), "Требование клиента: " + val("demand"),
  val("changed") && "Требование менялось: " + val("changed"), val("legal") && "Юридические упоминания: " + val("legal"),
  val("contacts") && "Контакты: " + val("contacts"), val("tasks") && "Задачи: " + val("tasks"),
  "Темы обращения: " + state.themes.map((t, idx) => `${idx + 1}. ${t.path} (${t.status})`).join("; ")
].filter(Boolean).join("\n");

/** Генерация стандартных действий чеклиста по умолчанию */
export function getDefaultActions() {
  return [
    {
      id: "act-themes",
      type: "themes",
      title: "Добавить в тикет темы обращения",
      done: false,
      open: true
    },
    {
      id: "act-chat",
      type: "chat",
      title: "Ответить клиенту в чате (Tone of Voice)",
      done: false,
      open: true
    },
    {
      id: "act-compensation",
      type: "compensation",
      title: "Начислить баллы / согласовать компенсацию",
      done: false,
      open: false,
      points: "",
      reason: ""
    },
    {
      id: "act-ctask",
      type: "ctask",
      title: "Задачи на внешние отделы / CTASK на контроль",
      done: false,
      open: false,
      tasks: [] // { id, url, desc }
    },
    {
      id: "act-comment",
      type: "service",
      title: "Закрыть тикет с комментарием",
      done: false,
      open: true
    }
  ];
}

/** Проверка незаполненных [квадратных скобок] */
export const countPlaceholders = (text) => (text.match(/\[[^\]\n]+\]/g) || []).length;

export const updPh = () => {
  const n = ["out-check", "out-reply", "out-comment"].reduce((a, id) => {
    const el = $(id);
    return a + (el ? countPlaceholders(el.value) : 0);
  }, 0);
  const noteEl = $("ph-note");
  if (noteEl) {
    noteEl.textContent = n ? `⚠️ Незаполненных полей в [квадратных скобках]: ${n}. Заполните перед копированием.` : "";
    noteEl.style.display = n ? "block" : "none";
  }
};

/** Синхронизация форматированного чеклиста в скрытое поле out-check для карточки кейса */
export function syncChecklistOut() {
  if (!state.actions) return;
  const outCheckEl = $("out-check");
  if (!outCheckEl) return;

  const lines = state.actions.map(a => {
    const mark = a.done ? "[x]" : "[ ]";
    let extra = "";
    if (a.type === "themes") {
      const toAdd = (state.themes || []).filter(t => t.status === "добавлю я");
      if (toAdd.length) {
        extra = ` (добавить: ${toAdd.map(t => t.path).join("; ")})`;
      } else {
        extra = " (все темы уже в тикете)";
      }
    } else if (a.type === "compensation" && (a.points || a.reason)) {
      const p = a.points ? `${a.points} баллов` : "";
      const r = a.reason ? `обоснование: ${a.reason}` : "";
      extra = ` (${[p, r].filter(Boolean).join(", ")})`;
    } else if (a.type === "ctask" && a.tasks && a.tasks.length) {
      extra = ` (задачи: ${a.tasks.map(t => `${t.url} [${t.desc || "на контроле"}]`).join("; ")})`;
    } else if (a.customText) {
      extra = ` (${a.customText.slice(0, 60)})`;
    }
    return `- ${mark} ${a.title}${extra}`;
  });

  outCheckEl.value = lines.join("\n");
  updPh();
}

/** Обновление бейджа прогресса чек-листа */
function updateProgressBadge() {
  const badge = $("checklist-progress-badge");
  if (!badge || !state.actions) return;
  const total = state.actions.length;
  const done = state.actions.filter(a => a.done).length;
  badge.textContent = `Выполнено ${done} из ${total}${done === total && total > 0 ? " ✅" : ""}`;
  if (done === total && total > 0) {
    badge.style.background = "rgba(28, 138, 99, 0.15)";
    badge.style.color = "var(--good)";
    badge.style.borderColor = "rgba(28, 138, 99, 0.35)";
  } else {
    badge.style.background = "";
    badge.style.color = "";
    badge.style.borderColor = "";
  }
}

/** Иконка бейджа типа действия */
function getTypeIcon(type) {
  switch (type) {
    case "themes": return "🏷️";
    case "chat": return "💬";
    case "compensation": return "🎁";
    case "ctask": return "↗";
    case "service": return "📋";
    default: return "⚡";
  }
}

/** Рендер карточек действий */
export function renderActionCards() {
  const container = $("action-cards-list");
  if (!container) return;

  if (state.actions === null || state.actions === undefined) {
    state.actions = getDefaultActions();
  }

  container.innerHTML = "";

  if (!state.actions.length) {
    const emptyMsg = document.createElement("div");
    emptyMsg.style.cssText = "padding:22px;text-align:center;background:var(--field);border:1.5px dashed var(--line);border-radius:10px;color:var(--soft);font-size:13.5px;line-height:1.5;";
    emptyMsg.innerHTML = `<span>Все пункты чек-листа удалены. Вы можете добавить новые действия ниже или вернуть базовые 5 действий.</span><br><button type="button" class="next small pri" id="btn-empty-restore" style="margin-top:12px;"><svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-reset"/></svg>Восстановить исходные 5 действий</button>`;
    container.appendChild(emptyMsg);
    const restoreBtn = $("btn-empty-restore");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => {
        state.actions = getDefaultActions();
        save();
        renderActionCards();
        syncChecklistOut();
      });
    }
    updateProgressBadge();
    return;
  }

  let draggedIndex = null;

  state.actions.forEach((act, index) => {
    const card = document.createElement("div");
    card.className = `action-card ${act.done ? "done" : ""}`;
    card.dataset.id = act.id;
    card.dataset.index = String(index);
    card.draggable = true;

    // Drag-and-drop обработчики
    card.addEventListener("dragstart", (e) => {
      // Игнорируем перетаскивание при фокусе в полях ввода и кнопках
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) {
        e.preventDefault();
        return;
      }
      draggedIndex = index;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".action-card").forEach(c => {
        c.classList.remove("drag-over-top", "drag-over-bottom");
      });
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedIndex === null || draggedIndex === index) return;

      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        card.classList.add("drag-over-top");
        card.classList.remove("drag-over-bottom");
      } else {
        card.classList.add("drag-over-bottom");
        card.classList.remove("drag-over-top");
      }
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over-top", "drag-over-bottom");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over-top", "drag-over-bottom");
      if (draggedIndex === null || draggedIndex === index) return;

      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      let targetIndex = index;
      if (e.clientY >= midY) {
        // Если бросили в нижнюю половину карточки
        targetIndex = draggedIndex < index ? index : index + 1;
      } else {
        // Если бросили в верхнюю половину карточки
        targetIndex = draggedIndex < index ? index - 1 : index;
      }
      if (targetIndex < 0) targetIndex = 0;
      if (targetIndex >= state.actions.length) targetIndex = state.actions.length - 1;

      // Перемещение элемента в массиве
      const itemToMove = state.actions.splice(draggedIndex, 1)[0];
      state.actions.splice(targetIndex, 0, itemToMove);
      draggedIndex = null;
      save();
      renderActionCards();
      syncChecklistOut();
    });

    // Header
    const header = document.createElement("div");
    header.className = "action-card-header";

    // Left
    const left = document.createElement("div");
    left.className = "action-card-left";

    // Drag handle
    const dragHandle = document.createElement("div");
    dragHandle.className = "action-drag-handle";
    dragHandle.title = "Потяните для перетаскивания (drag-and-drop)";
    dragHandle.innerHTML = `
      <div class="action-drag-icon">
        <span class="action-drag-dot"></span><span class="action-drag-dot"></span>
        <span class="action-drag-dot"></span><span class="action-drag-dot"></span>
        <span class="action-drag-dot"></span><span class="action-drag-dot"></span>
      </div>
    `;

    // Checkbox toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "action-check-toggle";
    toggleBtn.title = act.done ? "Выполнено (нажмите, чтобы снять отметку)" : "Нажмите, чтобы отметить выполненным";
    toggleBtn.innerHTML = act.done
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#1c8a63" stroke="#1c8a63" stroke-width="1.5"/><polyline points="8 12 11 15 16 9" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>`;

    toggleBtn.addEventListener("click", () => {
      act.done = !act.done;
      save();
      renderActionCards();
      syncChecklistOut();
    });

    // Type badge
    const badge = document.createElement("span");
    badge.className = `action-type-badge type-${act.type}`;
    badge.textContent = getTypeIcon(act.type);

    // Title text
    const titleEl = document.createElement("div");
    titleEl.className = "action-title-text";
    titleEl.textContent = act.title;

    left.append(dragHandle, toggleBtn, badge, titleEl);

    // Right
    const right = document.createElement("div");
    right.className = "action-card-right";

    // Кнопки быстрой сортировки вверх / вниз
    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "action-move-btn";
    moveUpBtn.title = "Переместить выше";
    moveUpBtn.disabled = index === 0;
    moveUpBtn.textContent = "▲";
    moveUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (index > 0) {
        const item = state.actions.splice(index, 1)[0];
        state.actions.splice(index - 1, 0, item);
        save();
        renderActionCards();
        syncChecklistOut();
      }
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "action-move-btn";
    moveDownBtn.title = "Переместить ниже";
    moveDownBtn.disabled = index === state.actions.length - 1;
    moveDownBtn.textContent = "▼";
    moveDownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (index < state.actions.length - 1) {
        const item = state.actions.splice(index, 1)[0];
        state.actions.splice(index + 1, 0, item);
        save();
        renderActionCards();
        syncChecklistOut();
      }
    });

    right.append(moveUpBtn, moveDownBtn);

    // Кнопка удаления (для ЛЮБОГО действия)
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "action-del-btn";
    delBtn.title = "Удалить это действие из чек-листа";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.actions = state.actions.filter(a => a.id !== act.id);
      save();
      renderActionCards();
      syncChecklistOut();
    });
    right.appendChild(delBtn);

    // Details button
    const detailsBtn = document.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.className = `action-details-btn ${act.open ? "open" : ""}`;
    detailsBtn.innerHTML = `<span>${act.open ? "Детали ▴" : "Детали ▾"}</span>`;
    detailsBtn.addEventListener("click", () => {
      act.open = !act.open;
      save();
      renderActionCards();
    });

    right.appendChild(detailsBtn);
    header.append(left, right);
    card.appendChild(header);

    // Details panel (visible when act.open)
    if (act.open) {
      const panel = document.createElement("div");
      panel.className = "action-details-panel";
      renderPanelContent(panel, act);
      card.appendChild(panel);
    }

    container.appendChild(card);
  });

  updateProgressBadge();
}

/** Рендер содержимого панели деталей в зависимости от типа действия */
function renderPanelContent(panel, act) {
  if (act.type === "themes") {
    renderThemesDetails(panel);
  } else if (act.type === "chat") {
    renderChatDetails(panel);
  } else if (act.type === "compensation") {
    renderCompensationDetails(panel, act);
  } else if (act.type === "ctask") {
    renderCtaskDetails(panel, act);
  } else if (act.type === "service" || act.type === "comment") {
    renderCommentDetails(panel);
  } else {
    renderCustomDetails(panel, act);
  }
}

/** 1. Детали действия: Темы обращения (к добавлению в тикет) */
function renderThemesDetails(panel) {
  const toAddThemes = (state.themes || []).filter(t => t.status === "добавлю я");

  if (!toAddThemes.length) {
    const emptyNotice = document.createElement("div");
    emptyNotice.style.cssText = "padding:10px 14px;background:rgba(28, 138, 99, 0.08);border:1px solid rgba(28, 138, 99, 0.25);border-radius:8px;font-size:13px;color:var(--good);line-height:1.45;";
    emptyNotice.innerHTML = `✅ <strong>Все темы уже добавлены в тикет WebCRM</strong> (или темы ещё не заданы на шаге 2). Дополнительных тем вносить не требуется.`;
    panel.appendChild(emptyNotice);
    return;
  }

  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = `Темы, которые нужно добавить в тикет WebCRM (в порядке сортировки с Шага 2):`;
  panel.appendChild(p);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:10px;";

  (state.themes || []).forEach((t, idx) => {
    if (t.status !== "добавлю я") return;

    const row = document.createElement("div");
    row.className = "theme-item-row";

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:10px;flex:1;min-width:0;";

    const num = document.createElement("span");
    num.className = "theme-num-badge";
    num.textContent = String(idx + 1);

    const txt = document.createElement("span");
    txt.style.cssText = "font-weight:600;font-size:13.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    txt.textContent = t.path;
    txt.title = t.path;

    left.append(num, txt);

    const right = document.createElement("div");
    right.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";

    const tag = document.createElement("span");
    tag.className = "theme-status-select st-to-add";
    tag.style.cssText = "padding:3px 8px;font-size:11.5px;";
    tag.textContent = "добавлю я";

    const cp = document.createElement("button");
    cp.type = "button";
    cp.className = "next small";
    cp.style.cssText = "padding:4px 10px;font-size:12px;";
    cp.textContent = "Копировать";
    cp.addEventListener("click", async () => {
      await copyText(t.path);
      cp.textContent = "✓ Скопировано";
      setTimeout(() => { cp.textContent = "Копировать"; }, 1500);
    });

    right.append(tag, cp);
    row.append(left, right);
    list.appendChild(row);
  });

  panel.appendChild(list);

  // Кнопка копирования всех тем разом
  const copyAllBtn = document.createElement("button");
  copyAllBtn.type = "button";
  copyAllBtn.className = "next small pri";
  copyAllBtn.style.cssText = "margin-top:4px;";
  copyAllBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать все темы для тикета (${toAddThemes.length})`;
  copyAllBtn.addEventListener("click", async () => {
    const allText = toAddThemes.map(t => t.path).join("\n");
    await copyText(allText);
    copyAllBtn.textContent = "✓ Все темы скопированы!";
    setTimeout(() => {
      copyAllBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать все темы для тикета (${toAddThemes.length})`;
    }, 1800);
  });

  panel.appendChild(copyAllBtn);
}

/** 2. Детали действия: Ответ клиенту в чате (Tone of Voice) */
function renderChatDetails(panel) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Текст сообщения клиенту с соблюдением Tone of Voice Loyalty:";
  panel.appendChild(p);

  const ta = document.createElement("textarea");
  ta.id = "step4-reply-textarea";
  ta.rows = 5;
  ta.placeholder = "Текст ответа клиенту в чате поддержки...";
  ta.value = val("out-reply");

  ta.addEventListener("input", (e) => {
    const outReply = $("out-reply");
    if (outReply) outReply.value = e.target.value;
    updPh();
    save();
    updateWarn();
  });

  panel.appendChild(ta);

  const warnEl = document.createElement("div");
  warnEl.className = "placeholder-warn";
  warnEl.style.display = "none";
  panel.appendChild(warnEl);

  const updateWarn = () => {
    const cnt = countPlaceholders(ta.value);
    if (cnt > 0) {
      warnEl.style.display = "inline-flex";
      warnEl.textContent = `⚠️ Незаполненных полей в [квадратных скобках]: ${cnt}`;
    } else {
      warnEl.style.display = "none";
    }
  };
  updateWarn();

  const toolbar = document.createElement("div");
  toolbar.className = "action-details-toolbar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "next small pri";
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать ответ`;
  copyBtn.addEventListener("click", async () => {
    await copyText(ta.value);
    copyBtn.textContent = "✓ Ответ скопирован!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать ответ`;
    }, 1500);
  });

  const charInfo = document.createElement("span");
  charInfo.className = "hint";
  charInfo.textContent = `${ta.value.length} симв.`;
  ta.addEventListener("input", () => { charInfo.textContent = `${ta.value.length} симв.`; });

  toolbar.append(copyBtn, charInfo);
  panel.appendChild(toolbar);
}

/** 3. Детали действия: Начислить баллы / согласовать компенсацию */
function renderCompensationDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Параметры начисления компенсации по регламенту и Памятке:";
  panel.appendChild(p);

  const grid = document.createElement("div");
  grid.className = "comp-fields-grid";

  // Баллы
  const pointsLabel = document.createElement("label");
  pointsLabel.className = "comp-field-label";
  pointsLabel.textContent = "Количество баллов:";
  const pointsInput = document.createElement("input");
  pointsInput.type = "number";
  pointsInput.placeholder = "например, 500";
  pointsInput.value = act.points || "";
  pointsInput.addEventListener("input", (e) => {
    act.points = e.target.value;
    save();
    syncChecklistOut();
  });
  pointsLabel.appendChild(pointsInput);

  // Обоснование
  const reasonLabel = document.createElement("label");
  reasonLabel.className = "comp-field-label";
  reasonLabel.textContent = "Обоснование расчета / пункт правил:";
  const reasonInput = document.createElement("input");
  reasonInput.type = "text";
  reasonInput.placeholder = "например: п. 3 Памятки — задержка экспресс-доставки свыше 24 часов";
  reasonInput.value = act.reason || "";
  reasonInput.addEventListener("input", (e) => {
    act.reason = e.target.value;
    save();
    syncChecklistOut();
  });
  reasonLabel.appendChild(reasonInput);

  grid.append(pointsLabel, reasonLabel);
  panel.appendChild(grid);

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "action-details-toolbar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "next small";
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать расчет компенсации`;
  copyBtn.addEventListener("click", async () => {
    const text = `Компенсация: ${act.points || 0} баллов. Обоснование: ${act.reason || "согласно регламенту"}`;
    await copyText(text);
    copyBtn.textContent = "✓ Расчет скопирован!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать расчет компенсации`;
    }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** 4. Детали действия: Задачи на внешние отделы / CTASK на контроль */
function renderCtaskDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Зафиксируйте ссылки на созданные задачи или тикеты CTASK на контроль:";
  panel.appendChild(p);

  if (!act.tasks) act.tasks = [];

  // Список существующих задач
  const list = document.createElement("div");
  list.className = "ctask-tasks-list";

  if (act.tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.style.margin = "4px 0 8px";
    empty.textContent = "Задачи на смежные отделы пока не добавлены.";
    list.appendChild(empty);
  } else {
    act.tasks.forEach((tsk, index) => {
      const item = document.createElement("div");
      item.className = "ctask-task-item";

      const left = document.createElement("div");
      left.className = "ctask-task-left";

      const linkEl = document.createElement("a");
      linkEl.className = "ctask-task-link";
      linkEl.href = tsk.url.startsWith("http") ? tsk.url : `https://${tsk.url}`;
      linkEl.target = "_blank";
      linkEl.rel = "noopener noreferrer";
      linkEl.textContent = tsk.url;

      const descEl = document.createElement("span");
      descEl.className = "ctask-task-desc";
      descEl.textContent = tsk.desc ? `— ${tsk.desc}` : "";

      left.append(linkEl, descEl);

      const actions = document.createElement("div");
      actions.className = "ctask-task-actions";

      const cp = document.createElement("button");
      cp.type = "button";
      cp.className = "next small";
      cp.style.cssText = "padding:3px 8px;font-size:12px;";
      cp.textContent = "Копировать";
      cp.addEventListener("click", async () => {
        await copyText(tsk.url);
        cp.textContent = "✓ Скопировано";
        setTimeout(() => { cp.textContent = "Копировать"; }, 1500);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "action-del-btn";
      del.title = "Удалить задачу";
      del.textContent = "🗑";
      del.addEventListener("click", () => {
        act.tasks.splice(index, 1);
        save();
        renderActionCards();
        syncChecklistOut();
      });

      actions.append(cp, del);
      item.append(left, actions);
      list.appendChild(item);
    });
  }

  panel.appendChild(list);

  // Форма добавления новой задачи
  const form = document.createElement("div");
  form.className = "ctask-add-form";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://crem.o3team.ru/tickets/748845026";

  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.placeholder = "Что ждём (например: акт о недостаче со склада)";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "next small pri";
  addBtn.style.margin = "0";
  addBtn.textContent = "ДОБАВИТЬ";

  addBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    const desc = descInput.value.trim();
    if (!url && !desc) {
      urlInput.focus();
      return;
    }
    act.tasks.push({
      id: Date.now(),
      url: url || "Задача без ссылки",
      desc: desc || ""
    });
    urlInput.value = "";
    descInput.value = "";
    save();
    renderActionCards();
    syncChecklistOut();
  });

  form.append(urlInput, descInput, addBtn);
  panel.appendChild(form);
}

/** 5. Детали действия: Закрыть тикет с комментарием */
function renderCommentDetails(panel) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Итоговый комментарий в тикет WebCRM при закрытии или передаче обращения:";
  panel.appendChild(p);

  const ta = document.createElement("textarea");
  ta.id = "step4-comment-textarea";
  ta.rows = 4;
  ta.placeholder = "Комментарий в тикет WebCRM...";
  ta.value = val("out-comment");

  ta.addEventListener("input", (e) => {
    const outComment = $("out-comment");
    if (outComment) outComment.value = e.target.value;
    updPh();
    save();
    updateWarn();
  });

  panel.appendChild(ta);

  const warnEl = document.createElement("div");
  warnEl.className = "placeholder-warn";
  warnEl.style.display = "none";
  panel.appendChild(warnEl);

  const updateWarn = () => {
    const cnt = countPlaceholders(ta.value);
    if (cnt > 0) {
      warnEl.style.display = "inline-flex";
      warnEl.textContent = `⚠️ Незаполненных полей в [квадратных скобках]: ${cnt}`;
    } else {
      warnEl.style.display = "none";
    }
  };
  updateWarn();

  const toolbar = document.createElement("div");
  toolbar.className = "action-details-toolbar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "next small pri";
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать комментарий`;
  copyBtn.addEventListener("click", async () => {
    await copyText(ta.value);
    copyBtn.textContent = "✓ Комментарий скопирован!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать комментарий`;
    }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** 6. Детали пользовательского действия */
function renderCustomDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Заметки и детали выполнения этого действия:";
  panel.appendChild(p);

  const ta = document.createElement("textarea");
  ta.rows = 3;
  ta.placeholder = "Дополнительные детали, ссылки или скрипт...";
  ta.value = act.customText || "";

  ta.addEventListener("input", (e) => {
    act.customText = e.target.value;
    save();
    syncChecklistOut();
  });

  panel.appendChild(ta);

  const toolbar = document.createElement("div");
  toolbar.className = "action-details-toolbar";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "next small";
  copyBtn.textContent = "Копировать текст";
  copyBtn.addEventListener("click", async () => {
    await copyText(ta.value);
    copyBtn.textContent = "✓ Скопировано!";
    setTimeout(() => { copyBtn.textContent = "Копировать текст"; }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** Инициализация модуля Шага 4 */
export function initStep4() {
  // Чекбоксы страниц инструкций Loyalty для промта
  const pagesList = $("pages-list");
  if (pagesList) {
    pagesList.innerHTML = "";
    DOCS.forEach(d => {
      const l = document.createElement("label"); l.className = "chk";
      const i = document.createElement("input"); i.type = "checkbox"; i.checked = true; i.id = "doc-" + d.id;
      const sp = document.createElement("span"); sp.id = "sz-" + d.id; sp.className = "hint";
      l.append(i, " " + d.title + " ", sp);
      pagesList.appendChild(l);
    });
  }

  // Сборка промта step003
  const buildBtn = $("build-prompt");
  if (buildBtn) {
    buildBtn.addEventListener("click", async () => {
      const st = $("prompt4-state");
      if (st) st.textContent = "Загружаю инструкции…";
      try {
        const tpl = await (await fetch("prompts/step003.md", { cache: "no-store" })).text();
        const blocks = []; let total = 0;
        for (const d of DOCS.filter(x => $("doc-" + x.id) && $("doc-" + x.id).checked)) {
          const raw = await ghGet("cache/pages/" + d.path + ".md");
          const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
          const meta = k => ((fm && fm[1].match(new RegExp("^" + k + ": (.*)$", "m"))) || [])[1] || "";
          const body = (fm ? raw.slice(fm[0].length) : raw).trim();
          const szEl = $("sz-" + d.id);
          if (szEl) szEl.textContent = "(" + body.length + " симв.)";
          total += body.length;
          blocks.push("=== СТРАНИЦА: " + (meta("title") || d.title) + " | адрес: " + meta("url") + " | дата страницы: " + (meta("pageDate") || "нет") + " ===\n" + body + "\n=== КОНЕЦ СТРАНИЦЫ ===");
        }
        const prompt = tpl.replace("{{ФАКТЫ}}", factsText()).replace("{{КОНТЕКСТ}}", verdict()).replace("{{ИНСТРУКЦИИ}}", blocks.join("\n\n"));
        const preEl = $("prompt4-text");
        if (preEl) preEl.textContent = prompt;
        const ok = await copyText(prompt);
        if (st) {
          st.textContent = (ok ? "Промт скопирован ✅ " : "Не удалось скопировать ⚠️ ") + "(" + prompt.length + " симв.)" + (prompt.length > 70000 ? " Много: снимите галочку с Tone of Voice." : "");
        }
      } catch (e) {
        if (st) st.textContent = "Ошибка: " + e.message + ". Проверьте подключение вверху страницы.";
      }
    });
  }

  // Разбор итогового ответа DeepSeek
  const parseBtn = $("parse4");
  if (parseBtn) {
    parseBtn.addEventListener("click", () => {
      const ansEl = $("answer4");
      const msg = $("parse4-msg");
      if (!ansEl) return;
      const res = parseAnswer(ansEl.value, LABELS4, true);

      if (!Object.keys(res).length) {
        if (msg) msg.textContent = "Не нашёл меток ЧЕКЛИСТ:, СООБЩЕНИЕ:, КОММЕНТАРИЙ:. Вставьте итоговый ответ DeepSeek.";
        return;
      }

      if (res.reply) {
        const outReply = $("out-reply");
        if (outReply) outReply.value = res.reply;
      }
      if (res.comment) {
        const outComment = $("out-comment");
        if (outComment) outComment.value = res.comment;
      }
      if (res.check) {
        const outCheck = $("out-check");
        if (outCheck) outCheck.value = res.check;
      }

      if (msg) {
        msg.textContent = "Заполнено: " + Object.keys(res).map(k => ({ check: "чеклист", reply: "ответ клиенту", comment: "комментарий" })[k]).join(", ") + ".";
      }

      updPh();

      // Сворачиваем аккордеон помощника для фокуса на чеклисте
      const h4 = $("helper4");
      if (h4) h4.open = false;

      save();
      renderActionCards();
    });
  }

  // Добавление нового действия
  const addActionBtn = $("btn-add-action");
  if (addActionBtn) {
    addActionBtn.addEventListener("click", () => {
      const titleInput = $("new-action-title");
      const typeSelect = $("new-action-type");
      if (!titleInput) return;
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }
      const type = typeSelect ? typeSelect.value : "service";
      if (!state.actions) state.actions = getDefaultActions();

      state.actions.push({
        id: "act-custom-" + Date.now(),
        type,
        title,
        done: false,
        open: true,
        customText: ""
      });

      titleInput.value = "";
      save();
      renderActionCards();
      syncChecklistOut();
    });
  }

  // Сброс / восстановление базовых действий чеклиста
  const resetActionsBtn = $("btn-reset-actions");
  if (resetActionsBtn) {
    resetActionsBtn.addEventListener("click", () => {
      state.actions = getDefaultActions();
      save();
      renderActionCards();
      syncChecklistOut();
    });
  }

  // Переход на Шаг 5
  const nextBtn = $("next-4");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      syncChecklistOut();
      goTo(5);
    });
  }

  // Слушатели скрытых полей
  ["out-check", "out-reply", "out-comment"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", updPh);
  });

  // Рендер при открытии Шага 4
  onRender(4, () => {
    renderActionCards();
    updPh();
  });
}
