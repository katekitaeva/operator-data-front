// Шаг 4. Решение и тексты: интерактивный диалог с DeepSeek,
// карточки действий чеклиста исполнения, разбор итогового блока и блок сопоставления кейсов (matching).

import { $, val, copyText } from "../ui.js";
import { state, save } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { DOCS, DICTIONARY_PATH } from "../config.js";
import { ghGet } from "../github.js";
import { verdict } from "./step1.js";

// Сессионный кэш справочника cases/dictionary.json
let cachedDictionary = null;

/** Загрузка справочника из приватного репозитория operator-data с сессионным кэшированием */
export async function loadDictionary() {
  if (cachedDictionary) return cachedDictionary;
  try {
    const raw = await ghGet(DICTIONARY_PATH);
    const json = JSON.parse(raw);
    cachedDictionary = json;
    if (json && json.version) {
      state.dictionaryVersion = json.version;
    }
    return json;
  } catch (e) {
    console.warn("loadDictionary() failed:", e.message);
    return null;
  }
}

/** Форматирование полей справочника для плейсхолдера {{СЛОВАРЬ}} */
export function formatDictionaryForPrompt(dict) {
  if (!dict || !dict.fields) {
    return "блок МАТЧИНГ заполни вручную";
  }
  const lines = [];
  const fields = dict.fields;

  for (const key of Object.keys(fields)) {
    // Исключаем weights, client, genericInstructionBlocks и т.д.
    if (["weights", "client", "genericInstructionBlocks"].includes(key)) continue;
    const f = fields[key];
    if (!f || typeof f !== "object") continue;

    const typeDesc = f.type === "many" ? "несколько значений через запятую" : "одно значение";
    const desc = f.description ? `: ${f.description}` : "";
    lines.push(`${key} (${typeDesc})${desc}`);

    if (f.values) {
      if (Array.isArray(f.values)) {
        f.values.forEach(v => {
          lines.push(`  ${v}`);
        });
      } else if (typeof f.values === "object") {
        for (const valKey of Object.keys(f.values)) {
          const valDesc = f.values[valKey];
          lines.push(`  ${valKey} — ${valDesc}`);
        }
      }
    }
  }

  return lines.join("\n");
}

const factsText = () => [
  "Суть проблемы: " + val("problem"), "Требование клиента: " + val("demand"),
  val("changed") && "Требование менялось: " + val("changed"), val("legal") && "Юридические упоминания: " + val("legal"),
  val("contacts") && "Контакты: " + val("contacts"), val("tasks") && "Задачи: " + val("tasks"),
  "Темы обращения: " + state.themes.map((t, idx) => `${idx + 1}. ${t.path} (${t.status})`).join("; ")
].filter(Boolean).join("\n");

/** Генерация стандартных действий чеклиста по умолчанию (библиотека из п. 5 ТЗ) */
export function getDefaultActions() {
  return [
    {
      id: "act-themes",
      type: "themes",
      title: "Добавить темы тикета в обращение",
      done: false,
      open: true
    },
    {
      id: "act-call",
      type: "call",
      title: "Звонок клиенту",
      done: false,
      open: true,
      time: "",
      script: ""
    },
    {
      id: "act-chat",
      type: "chat",
      title: "Ответить клиенту в чате (Tone of Voice)",
      done: false,
      open: true,
      text: ""
    },
    {
      id: "act-compensation",
      type: "compensation",
      title: "Начислить баллы / согласовать компенсацию",
      done: false,
      open: false,
      compType: "баллы",
      points: "",
      reason: "",
      approval: ""
    },
    {
      id: "act-task-1",
      type: "task",
      title: "Задача",
      done: false,
      open: false,
      target: "",
      text: "",
      taskNo: ""
    },
    {
      id: "act-comment",
      type: "comment",
      title: "Закрыть тикет с комментарием",
      done: false,
      open: true,
      commentText: ""
    }
  ];
}

/** Подсчет незаполненных [квадратных скобок] */
export const countPlaceholders = (text) => (String(text || "").match(/\[[^\]\n]+\]/g) || []).length;

/** Подсчет плейсхолдеров во всех действиях и полях шага 4 */
export const countAllPlaceholders = () => {
  let count = 0;
  if (Array.isArray(state.actions)) {
    state.actions.forEach(a => {
      if (a.type === "call") {
        count += countPlaceholders(a.time) + countPlaceholders(a.script);
      } else if (a.type === "chat") {
        count += countPlaceholders(a.text || val("out-reply"));
      } else if (a.type === "compensation") {
        count += countPlaceholders(a.points) + countPlaceholders(a.reason) + countPlaceholders(a.approval);
      } else if (a.type === "task") {
        count += countPlaceholders(a.target) + countPlaceholders(a.text) + countPlaceholders(a.taskNo);
      } else if (a.type === "comment" || a.type === "service") {
        count += countPlaceholders(a.commentText || val("out-comment"));
      } else if (a.customText) {
        count += countPlaceholders(a.customText);
      }
    });
  }
  const matchingEl = $("matching-text");
  if (matchingEl) {
    count += countPlaceholders(matchingEl.value);
  }
  return count;
};

export const updPh = () => {
  const n = countAllPlaceholders();
  const noteEl = $("ph-note");
  if (noteEl) {
    noteEl.textContent = n ? `⚠️ Незаполненных полей в [квадратных скобках]: ${n}. Заполните перед копированием.` : "";
    noteEl.style.display = n ? "block" : "none";
  }
};

/** Синхронизация чеклиста в скрытые поля out-check, out-reply, out-comment для карточки кейса */
export function syncChecklistOut() {
  if (!state.actions) return;
  const outCheckEl = $("out-check");
  const outReplyEl = $("out-reply");
  const outCommentEl = $("out-comment");

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
    } else if (a.type === "call") {
      const parts = [];
      if (a.time) parts.push(`время: ${a.time}`);
      if (a.script) parts.push(`скрипт: ${a.script.slice(0, 50)}…`);
      if (parts.length) extra = ` (${parts.join(", ")})`;
    } else if (a.type === "chat") {
      if (a.text) extra = ` (${a.text.slice(0, 50)}…)`;
      if (outReplyEl && a.text !== undefined) outReplyEl.value = a.text;
    } else if (a.type === "compensation") {
      const parts = [];
      if (a.compType) parts.push(`тип: ${a.compType}`);
      if (a.points) parts.push(`${a.points} ${a.compType === "компенсация" ? "₽" : "баллов"}`);
      if (a.reason) parts.push(`причина: ${a.reason}`);
      if (a.approval) parts.push(`согласование: ${a.approval}`);
      if (parts.length) extra = ` (${parts.join(", ")})`;
    } else if (a.type === "task") {
      const parts = [];
      if (a.target) parts.push(`кому: ${a.target}`);
      if (a.taskNo) parts.push(`тикет: ${a.taskNo}`);
      if (a.text) parts.push(`текст: ${a.text.slice(0, 40)}…`);
      if (parts.length) extra = ` (${parts.join(", ")})`;
    } else if (a.type === "comment" || a.type === "service") {
      if (a.commentText && outCommentEl) outCommentEl.value = a.commentText;
    } else if (a.customText) {
      extra = ` (${a.customText.slice(0, 50)})`;
    }
    return `- ${mark} ${a.title}${extra}`;
  });

  if (outCheckEl) outCheckEl.value = lines.join("\n");
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
    case "call": return "📞";
    case "chat": return "💬";
    case "compensation": return "🎁";
    case "task":
    case "ctask": return "↗";
    case "comment":
    case "service": return "📋";
    default: return "⚡";
  }
}

/** Подсчет незаполненных плейсхолдеров внутри конкретной карточки действия */
function getActionPlaceholdersCount(act) {
  let count = 0;
  if (act.type === "call") {
    count = countPlaceholders(act.time) + countPlaceholders(act.script);
  } else if (act.type === "chat") {
    count = countPlaceholders(act.text);
  } else if (act.type === "compensation") {
    count = countPlaceholders(act.points) + countPlaceholders(act.reason) + countPlaceholders(act.approval);
  } else if (act.type === "task") {
    count = countPlaceholders(act.target) + countPlaceholders(act.text) + countPlaceholders(act.taskNo);
  } else if (act.type === "comment" || act.type === "service") {
    count = countPlaceholders(act.commentText);
  } else if (act.customText) {
    count = countPlaceholders(act.customText);
  }
  return count;
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
    emptyMsg.innerHTML = `<span>Все пункты чек-листа удалены. Вы можете добавить новые действия ниже или вернуть стандартные действия.</span><br><button type="button" class="next small pri" id="btn-empty-restore" style="margin-top:12px;"><svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-reset"/></svg>Восстановить действия по умолчанию</button>`;
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

    // Drag-and-drop
    card.addEventListener("dragstart", (e) => {
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
        targetIndex = draggedIndex < index ? index : index + 1;
      } else {
        targetIndex = draggedIndex < index ? index - 1 : index;
      }
      if (targetIndex < 0) targetIndex = 0;
      if (targetIndex >= state.actions.length) targetIndex = state.actions.length - 1;

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

    // Подсветка наличия незаполненных скобок в карточке
    const phCount = getActionPlaceholdersCount(act);
    if (phCount > 0) {
      const phBadge = document.createElement("span");
      phBadge.className = "action-card-ph-badge";
      phBadge.title = `В пункте ${phCount} незаполненных полей в [квадратных скобках]`;
      phBadge.textContent = `⚠️ [${phCount}]`;
      left.appendChild(phBadge);
    }

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

    // Кнопка удаления
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

    // Details panel
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

/** Рендер содержимого панели деталей */
function renderPanelContent(panel, act) {
  if (act.type === "themes") {
    renderThemesDetails(panel);
  } else if (act.type === "call") {
    renderCallDetails(panel, act);
  } else if (act.type === "chat") {
    renderChatDetails(panel, act);
  } else if (act.type === "compensation") {
    renderCompensationDetails(panel, act);
  } else if (act.type === "task" || act.type === "ctask") {
    renderTaskDetails(panel, act);
  } else if (act.type === "comment" || act.type === "service") {
    renderCommentDetails(panel, act);
  } else {
    renderCustomDetails(panel, act);
  }
}

/** 1. Детали действия: Темы обращения */
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

/** 2. Детали действия: Звонок клиенту (новое действие по ТЗ) */
function renderCallDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Параметры и согласованный скрипт разговора при звонке клиенту:";
  panel.appendChild(p);

  // Поле времени звонка
  const timeLabel = document.createElement("label");
  timeLabel.className = "comp-field-label";
  timeLabel.style.marginBottom = "10px";
  timeLabel.textContent = "Время звонка:";
  const timeInput = document.createElement("input");
  timeInput.type = "text";
  timeInput.placeholder = "Например: 14:30 или [время звонка]";
  timeInput.value = act.time || "";
  if (countPlaceholders(timeInput.value) > 0) timeInput.classList.add("input-has-placeholder");

  timeInput.addEventListener("input", (e) => {
    act.time = e.target.value;
    if (countPlaceholders(act.time) > 0) timeInput.classList.add("input-has-placeholder");
    else timeInput.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  timeLabel.appendChild(timeInput);
  panel.appendChild(timeLabel);

  // Поле скрипта разговора
  const scriptLabel = document.createElement("label");
  scriptLabel.className = "comp-field-label";
  scriptLabel.textContent = "Скрипт разговора с клиентом:";
  const scriptTa = document.createElement("textarea");
  scriptTa.rows = 5;
  scriptTa.placeholder = "Скрипт звонка клиенту (что скажет оператор)...";
  scriptTa.value = act.script || "";
  if (countPlaceholders(scriptTa.value) > 0) scriptTa.classList.add("input-has-placeholder");

  scriptTa.addEventListener("input", (e) => {
    act.script = e.target.value;
    if (countPlaceholders(act.script) > 0) scriptTa.classList.add("input-has-placeholder");
    else scriptTa.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  scriptLabel.appendChild(scriptTa);
  panel.appendChild(scriptLabel);

  const warnEl = document.createElement("div");
  warnEl.className = "placeholder-warn";
  warnEl.style.display = "none";
  panel.appendChild(warnEl);

  const updateWarn = () => {
    const cnt = countPlaceholders(timeInput.value) + countPlaceholders(scriptTa.value);
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
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать скрипт звонка`;
  copyBtn.addEventListener("click", async () => {
    const full = `Время: ${act.time || "[не указано]"}\nСкрипт:\n${act.script || ""}`;
    await copyText(full);
    copyBtn.textContent = "✓ Скрипт скопирован!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать скрипт звонка`;
    }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** 3. Детали действия: Ответ клиенту в чате */
function renderChatDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Текст сообщения клиенту с соблюдением Tone of Voice Loyalty:";
  panel.appendChild(p);

  const ta = document.createElement("textarea");
  ta.id = "step4-reply-textarea";
  ta.rows = 5;
  ta.placeholder = "Текст ответа клиенту в чате поддержки...";
  ta.value = act.text !== undefined ? act.text : val("out-reply");
  if (countPlaceholders(ta.value) > 0) ta.classList.add("input-has-placeholder");

  ta.addEventListener("input", (e) => {
    act.text = e.target.value;
    const outReply = $("out-reply");
    if (outReply) outReply.value = e.target.value;
    if (countPlaceholders(act.text) > 0) ta.classList.add("input-has-placeholder");
    else ta.classList.remove("input-has-placeholder");
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

/** 4. Детали действия: Начислить баллы / согласовать компенсацию */
function renderCompensationDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Параметры начисления компенсации по регламенту и Памятке:";
  panel.appendChild(p);

  const grid = document.createElement("div");
  grid.className = "comp-fields-grid";
  grid.style.gridTemplateColumns = "140px 140px 1fr";

  // Тип (баллы или компенсация)
  const typeLabel = document.createElement("label");
  typeLabel.className = "comp-field-label";
  typeLabel.textContent = "Тип:";
  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = `<option value="баллы">баллы</option><option value="компенсация">компенсация</option>`;
  typeSelect.value = act.compType || "баллы";
  typeSelect.addEventListener("change", (e) => {
    act.compType = e.target.value;
    save();
    syncChecklistOut();
  });
  typeLabel.appendChild(typeSelect);

  // Сумма
  const pointsLabel = document.createElement("label");
  pointsLabel.className = "comp-field-label";
  pointsLabel.textContent = "Сумма:";
  const pointsInput = document.createElement("input");
  pointsInput.type = "text";
  pointsInput.placeholder = "например, 500 или [N баллов]";
  pointsInput.value = act.points || "";
  if (countPlaceholders(pointsInput.value) > 0) pointsInput.classList.add("input-has-placeholder");
  pointsInput.addEventListener("input", (e) => {
    act.points = e.target.value;
    if (countPlaceholders(act.points) > 0) pointsInput.classList.add("input-has-placeholder");
    else pointsInput.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  pointsLabel.appendChild(pointsInput);

  // Причина
  const reasonLabel = document.createElement("label");
  reasonLabel.className = "comp-field-label";
  reasonLabel.textContent = "Причина начисления:";
  const reasonInput = document.createElement("input");
  reasonInput.type = "text";
  reasonInput.placeholder = "например: задержка экспресс-доставки свыше 24 ч";
  reasonInput.value = act.reason || "";
  if (countPlaceholders(reasonInput.value) > 0) reasonInput.classList.add("input-has-placeholder");
  reasonInput.addEventListener("input", (e) => {
    act.reason = e.target.value;
    if (countPlaceholders(act.reason) > 0) reasonInput.classList.add("input-has-placeholder");
    else reasonInput.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  reasonLabel.appendChild(reasonInput);

  grid.append(typeLabel, pointsLabel, reasonLabel);
  panel.appendChild(grid);

  // Поле Согласование
  const appLabel = document.createElement("label");
  appLabel.className = "comp-field-label";
  appLabel.style.marginBottom = "10px";
  appLabel.textContent = "Согласование (текст / РГ / не требуется):";
  const appInput = document.createElement("input");
  appInput.type = "text";
  appInput.placeholder = "не требуется или согласовано с РГ";
  appInput.value = act.approval || "";
  if (countPlaceholders(appInput.value) > 0) appInput.classList.add("input-has-placeholder");
  appInput.addEventListener("input", (e) => {
    act.approval = e.target.value;
    if (countPlaceholders(act.approval) > 0) appInput.classList.add("input-has-placeholder");
    else appInput.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  appLabel.appendChild(appInput);
  panel.appendChild(appLabel);

  const warnEl = document.createElement("div");
  warnEl.className = "placeholder-warn";
  warnEl.style.display = "none";
  panel.appendChild(warnEl);

  const updateWarn = () => {
    const cnt = countPlaceholders(pointsInput.value) + countPlaceholders(reasonInput.value) + countPlaceholders(appInput.value);
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
  copyBtn.className = "next small";
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать расчет компенсации`;
  copyBtn.addEventListener("click", async () => {
    const text = `Компенсация: ${act.compType || "баллы"} ${act.points || 0}. Причина: ${act.reason || "согласно регламенту"}. Согласование: ${act.approval || "не требуется"}`;
    await copyText(text);
    copyBtn.textContent = "✓ Расчет скопирован!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать расчет компенсации`;
    }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** 5. Детали действия: Задача (отдельный пункт по ТЗ) */
function renderTaskDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Параметры задачи на внешний отдел или CTASK на контроль:";
  panel.appendChild(p);

  const row = document.createElement("div");
  row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;";

  // Кому
  const targetLabel = document.createElement("label");
  targetLabel.className = "comp-field-label";
  targetLabel.textContent = "Кому (отдел или CTASK):";
  const targetInput = document.createElement("input");
  targetInput.type = "text";
  targetInput.placeholder = "например: отдел доставки, CTASK";
  targetInput.value = act.target || "";
  if (countPlaceholders(targetInput.value) > 0) targetInput.classList.add("input-has-placeholder");
  targetInput.addEventListener("input", (e) => {
    act.target = e.target.value;
    if (countPlaceholders(act.target) > 0) targetInput.classList.add("input-has-placeholder");
    else targetInput.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  targetLabel.appendChild(targetInput);

  // Номер из WebCRM
  const taskNoLabel = document.createElement("label");
  taskNoLabel.className = "comp-field-label";
  taskNoLabel.textContent = "Номер из WebCRM (или [номер]):";
  const taskNoInput = document.createElement("input");
  taskNoInput.type = "text";
  taskNoInput.placeholder = "748845026 или [номер]";
  taskNoInput.value = act.taskNo || "";
  if (countPlaceholders(taskNoInput.value) > 0) taskNoInput.classList.add("input-has-placeholder");

  const linkContainer = document.createElement("div");
  linkContainer.style.marginTop = "6px";

  const updateLink = () => {
    const rawNo = (act.taskNo || "").trim();
    linkContainer.innerHTML = "";
    const cleanDigits = rawNo.replace(/\D/g, "");
    if (cleanDigits.length >= 4) {
      const a = document.createElement("a");
      a.className = "task-link-badge";
      a.href = `https://crm.o3team.ru/tickets/${cleanDigits}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Открыть в CRM (тикет #${cleanDigits})`;
      linkContainer.appendChild(a);
    }
  };

  taskNoInput.addEventListener("input", (e) => {
    act.taskNo = e.target.value;
    if (countPlaceholders(act.taskNo) > 0) taskNoInput.classList.add("input-has-placeholder");
    else taskNoInput.classList.remove("input-has-placeholder");
    updateLink();
    save();
    syncChecklistOut();
    updateWarn();
  });
  taskNoLabel.appendChild(taskNoInput);
  taskNoLabel.appendChild(linkContainer);
  updateLink();

  row.append(targetLabel, taskNoLabel);
  panel.appendChild(row);

  // Текст задачи
  const textLabel = document.createElement("label");
  textLabel.className = "comp-field-label";
  textLabel.textContent = "Текст задачи (формулировка):";
  const textTa = document.createElement("textarea");
  textTa.rows = 3;
  textTa.placeholder = "Что именно требуется сделать / проверить...";
  textTa.value = act.text || "";
  if (countPlaceholders(textTa.value) > 0) textTa.classList.add("input-has-placeholder");
  textTa.addEventListener("input", (e) => {
    act.text = e.target.value;
    if (countPlaceholders(act.text) > 0) textTa.classList.add("input-has-placeholder");
    else textTa.classList.remove("input-has-placeholder");
    save();
    syncChecklistOut();
    updateWarn();
  });
  textLabel.appendChild(textTa);
  panel.appendChild(textLabel);

  const warnEl = document.createElement("div");
  warnEl.className = "placeholder-warn";
  warnEl.style.display = "none";
  panel.appendChild(warnEl);

  const updateWarn = () => {
    const cnt = countPlaceholders(targetInput.value) + countPlaceholders(taskNoInput.value) + countPlaceholders(textTa.value);
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
  copyBtn.className = "next small";
  copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать задачу`;
  copyBtn.addEventListener("click", async () => {
    const formatted = `Кому: ${act.target || "отдел"}\nНомер: ${act.taskNo || "[номер]"}\nТекст: ${act.text || ""}`;
    await copyText(formatted);
    copyBtn.textContent = "✓ Скопировано!";
    setTimeout(() => {
      copyBtn.innerHTML = `<svg class="i" aria-hidden="true" focusable="false"><use href="assets/icons.svg#i-copy"/></svg>Скопировать задачу`;
    }, 1500);
  });

  toolbar.appendChild(copyBtn);
  panel.appendChild(toolbar);
}

/** 6. Детали действия: Закрыть тикет с комментарием */
function renderCommentDetails(panel, act) {
  const p = document.createElement("p");
  p.className = "action-subhint";
  p.textContent = "Итоговый структурированный комментарий в тикет WebCRM в 4 частях (ПРОБЛЕМА, ТРЕБУЕТ, СДЕЛАНО, ОБОСНОВАНИЕ):";
  panel.appendChild(p);

  const ta = document.createElement("textarea");
  ta.id = "step4-comment-textarea";
  ta.rows = 5;
  ta.placeholder = "1. ПРОБЛЕМА: ...\n2. ТРЕБУЕТ: ...\n3. СДЕЛАНО: ...\n4. ОБОСНОВАНИЕ: ...";
  ta.value = act.commentText !== undefined ? act.commentText : val("out-comment");
  if (countPlaceholders(ta.value) > 0) ta.classList.add("input-has-placeholder");

  ta.addEventListener("input", (e) => {
    act.commentText = e.target.value;
    const outComment = $("out-comment");
    if (outComment) outComment.value = e.target.value;
    if (countPlaceholders(act.commentText) > 0) ta.classList.add("input-has-placeholder");
    else ta.classList.remove("input-has-placeholder");
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

/** 7. Детали пользовательского действия */
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

/**
 * Парсер итогового ответа DeepSeek строго по правилам п. 6 ТЗ.
 * Извлекает блок между ИТОГ ДЛЯ ФОРМЫ и КОНЕЦ ИТОГА.
 */
export function parseStep4FinalResponse(rawText) {
  const text = String(rawText || "");
  const startTag = "ИТОГ ДЛЯ ФОРМЫ";
  const endTag = "КОНЕЦ ИТОГА";

  const startIdx = text.lastIndexOf(startTag);
  const endIdx = text.lastIndexOf(endTag);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { error: "no_boundaries" };
  }

  // Текст строго между границами
  const blockContent = text.slice(startIdx + startTag.length, endIdx).trim();

  // Разбиваем на строки, очищаем от markdown (звездочек)
  const rawLines = blockContent.split(/\r?\n/).map(l => l.replace(/\*+/g, "").trim());

  let resolutionTitle = "";
  const actionsList = [];
  let currentAction = null;
  let currentField = null;
  let inComment = false;
  let commentLines = [];
  let inMatching = false;
  const matchingLines = [];

  const KNOWN_FIELDS = [
    "РЕШЕНИЕ", "ВРЕМЯ", "СКРИПТ", "ТЕКСТ", "ТИП", "СУММА",
    "ПРИЧИНА", "СОГЛАСОВАНИЕ", "КОМУ", "НОМЕР", "КОММЕНТАРИЙ"
  ];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line && !inComment) continue;

    // 1. Проверка начала блока МАТЧИНГ (приоритет над комментарием)
    if (/^(?:МАТЧИНГ|MATCHING)(?:\s*[:：]|\s*$)/i.test(line)) {
      inMatching = true;
      inComment = false;
      continue;
    }

    if (inMatching) {
      if (line) matchingLines.push(line);
      continue;
    }

    // 2. Проверка ДЕЙСТВИЕ (приоритет над комментарием)
    const actMatch = line.match(/^(?:[-\d.)\s]*)(?:ДЕЙСТВИЕ|ACTION)[:：]\s*(.*)$/i);
    if (actMatch) {
      inComment = false;
      currentField = null;
      const rawType = actMatch[1].trim().toUpperCase();
      currentAction = {
        rawType,
        fields: {}
      };
      actionsList.push(currentAction);
      continue;
    }

    // 3. Если мы внутри комментария действия ЗАКРЫТИЕ:
    // строки 1. ПРОБЛЕМА, 2. ТРЕБУЕТ и т.д. должны сохраняться в комментарии
    if (inComment && currentAction && currentAction.rawType === "ЗАКРЫТИЕ") {
      commentLines.push(line);
      currentAction.fields.КОММЕНТАРИЙ = commentLines;
      continue;
    }

    // 4. Проверка известных полей
    const fieldMatch = line.match(/^(?:[-\d.)\s]*)([A-Za-zА-Яа-яЁё0-9_\s]+?)[:：]\s*(.*)$/);
    if (fieldMatch) {
      const tagCandidate = fieldMatch[1].trim().toUpperCase();
      const valRest = fieldMatch[2] ? fieldMatch[2].trim() : "";

      if (tagCandidate === "РЕШЕНИЕ") {
        resolutionTitle = valRest;
        inComment = false;
        currentField = null;
        continue;
      }

      if (KNOWN_FIELDS.includes(tagCandidate) && currentAction) {
        if (tagCandidate === "КОММЕНТАРИЙ") {
          inComment = true;
          commentLines = [];
          if (valRest) commentLines.push(valRest);
          currentAction.fields.КОММЕНТАРИЙ = commentLines;
          currentField = "КОММЕНТАРИЙ";
          continue;
        } else {
          inComment = false;
          currentAction.fields[tagCandidate] = valRest;
          currentField = tagCandidate;
          continue;
        }
      }
    }

    // 5. Если строка не является новой меткой, дописываем её в текущее поле
    if (inComment && currentAction) {
      commentLines.push(line);
      currentAction.fields.КОММЕНТАРИЙ = commentLines;
    } else if (currentAction && currentField) {
      if (typeof currentAction.fields[currentField] === "string") {
        currentAction.fields[currentField] += "\n" + line;
      }
    }
  }

  if (actionsList.length === 0) {
    return { error: "no_actions" };
  }

  return {
    resolutionTitle,
    actions: actionsList,
    matching: matchingLines.join("\n")
  };
}

/** Проверка и валидация блока matching по справочнику */
export function validateMatchingText(text, dict) {
  const warnings = [];
  if (!text || !text.trim()) return warnings;

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsed = {};

  lines.forEach(l => {
    const m = l.match(/^([a-zA-Z0-9_]+)\s*[:：]\s*(.*)$/);
    if (m) {
      parsed[m[1].trim()] = m[2].trim();
    }
  });

  if (!dict || !dict.fields) {
    return warnings;
  }

  const fields = dict.fields;
  for (const [key, valStr] of Object.entries(parsed)) {
    if (key === "essence") continue; // произвольный текст
    const fieldDef = fields[key];
    if (!fieldDef || !fieldDef.values) continue;

    const validValues = new Set(
      Array.isArray(fieldDef.values)
        ? fieldDef.values
        : Object.keys(fieldDef.values)
    );
    // Допустимы special values: other, unclear
    validValues.add("other");
    validValues.add("unclear");

    if (fieldDef.type === "many") {
      const items = valStr.split(",").map(s => s.trim()).filter(Boolean);
      items.forEach(item => {
        if (!validValues.has(item)) {
          warnings.push(`Значение «${item}» в ${key} не из справочника, поправь или поставь other`);
        }
      });
    } else {
      if (valStr && !validValues.has(valStr)) {
        warnings.push(`Значение «${valStr}» в ${key} не из справочника, поправь или поставь other`);
      }
    }
  }

  return warnings;
}

/** Обновление и подсветка блока matching */
export function updateMatchingUI(dict) {
  const ta = $("matching-text");
  const warnBox = $("matching-warnings");
  const badge = $("matching-version-badge");
  if (!ta) return;

  if (badge) {
    badge.textContent = state.dictionaryVersion ? `словарь v${state.dictionaryVersion}` : "matching";
  }

  const text = ta.value.trim();
  state.matchingText = text;

  if (!warnBox) return;

  if (!text) {
    warnBox.style.display = "block";
    warnBox.className = "matching-warnings-box";
    warnBox.innerHTML = `<strong>Блок МАТЧИНГ не заполнен</strong><span>Заполните данные для сопоставления кейсов по справочнику.</span>`;
    return;
  }

  if (!dict) {
    warnBox.style.display = "none";
    return;
  }

  const warnings = validateMatchingText(text, dict);
  if (warnings.length > 0) {
    warnBox.style.display = "block";
    warnBox.className = "matching-warnings-box";
    warnBox.innerHTML = `<strong>⚠️ Предупреждения сопоставления со справочником:</strong><ul class="matching-warnings-list">${warnings.map(w => `<li>${w}</li>`).join("")}</ul>`;
  } else {
    warnBox.style.display = "none";
  }
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
      if (st) st.textContent = "Загружаю инструкции и справочник…";
      try {
        // 1. Чтение шаблона промта
        const tpl = await (await fetch("prompts/step003.md", { cache: "no-store" })).text();

        // 2. Чтение справочника cases/dictionary.json
        let dictText = "блок МАТЧИНГ заполни вручную";
        let dictWarning = false;
        try {
          const dict = await loadDictionary();
          if (dict) {
            dictText = formatDictionaryForPrompt(dict);
          } else {
            dictWarning = true;
          }
        } catch (e) {
          dictWarning = true;
        }

        // 3. Загрузка страниц инструкций
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

        // 4. Подстановка четырёх плейсхолдеров
        const prompt = tpl
          .replace("{{ФАКТЫ}}", factsText())
          .replace("{{КОНТЕКСТ}}", verdict())
          .replace("{{ИНСТРУКЦИИ}}", blocks.join("\n\n"))
          .replace("{{СЛОВАРЬ}}", dictText);

        const preEl = $("prompt4-text");
        if (preEl) preEl.textContent = prompt;

        const ok = await copyText(prompt);
        if (st) {
          const warnNote = dictWarning ? " (⚠️ Справочник недоступен)" : "";
          st.textContent = (ok ? "Промт скопирован ✅ " : "Не удалось скопировать ⚠️ ") + "(" + prompt.length + " симв.)" + warnNote;
        }
      } catch (e) {
        if (st) st.textContent = "Ошибка: " + e.message + ". Проверьте подключение вверху страницы.";
      }
    });
  }

  // Разбор итогового ответа DeepSeek
  const parseBtn = $("parse4");
  if (parseBtn) {
    parseBtn.addEventListener("click", async () => {
      const ansEl = $("answer4");
      const msg = $("parse4-msg");
      if (!ansEl) return;
      const text = ansEl.value;

      // Если в форме уже есть настроенные действия, запрашиваем подтверждение
      const hasExisting = Array.isArray(state.actions) && state.actions.length > 0;
      if (hasExisting && !confirm("Состояние шага 4 будет перезаписано. Продолжить?")) {
        return;
      }

      const parsed = parseStep4FinalResponse(text);

      if (parsed.error) {
        if (msg) {
          msg.className = "hint msg er";
          msg.textContent = "Попроси DeepSeek: выдай итоговый блок строго в формате (между ИТОГ ДЛЯ ФОРМЫ и КОНЕЦ ИТОГА).";
        }
        return;
      }

      // Запоминаем прежние отметки «Сделано» для сохранения состояния пунктов того же типа
      const oldDoneMap = {};
      const oldTaskDones = [];
      if (Array.isArray(state.actions)) {
        state.actions.forEach(a => {
          if (a.type === "task") {
            oldTaskDones.push(!!a.done);
          } else {
            oldDoneMap[a.type] = !!a.done;
          }
        });
      }

      const prevCount = Array.isArray(state.actions) ? state.actions.length : 5;
      const newActions = [];
      const warningsList = [];
      let taskIdx = 0;

      // 1. «Добавить темы тикета в обращение» (всегда остаётся первым)
      newActions.push({
        id: "act-themes",
        type: "themes",
        title: "Добавить темы тикета в обращение",
        done: !!oldDoneMap["themes"],
        open: true
      });

      // 2. Добавляем распознанные действия в порядке блоков в ответе
      let hasClosing = false;
      let closingCommentText = "";

      parsed.actions.forEach((rawAct, idx) => {
        const t = rawAct.rawType;
        const f = rawAct.fields;

        if (t === "ЗВОНОК") {
          const actTime = (f.ВРЕМЯ || "").trim();
          const actScript = (f.СКРИПТ || "").trim();
          newActions.push({
            id: `act-call-${idx}`,
            type: "call",
            title: "Звонок клиенту",
            done: !!oldDoneMap["call"],
            open: true,
            time: actTime,
            script: actScript
          });
          const ph = countPlaceholders(actTime) + countPlaceholders(actScript);
          if (ph) warningsList.push(`Звонок: незаполненных плейсхолдеров ${ph}`);
        } else if (t === "ЧАТ") {
          const chatText = (f.ТЕКСТ || "").trim();
          newActions.push({
            id: `act-chat-${idx}`,
            type: "chat",
            title: "Ответить клиенту в чате (Tone of Voice)",
            done: !!oldDoneMap["chat"],
            open: true,
            text: chatText
          });
          const ph = countPlaceholders(chatText);
          if (ph) warningsList.push(`Чат: незаполненных плейсхолдеров ${ph}`);
        } else if (t === "БАЛЛЫ") {
          const compType = (f.ТИП || "баллы").toLowerCase();
          const points = (f.СУММА || "").trim();
          const reason = (f.ПРИЧИНА || "").trim();
          const approval = (f.СОГЛАСОВАНИЕ || "").trim();
          newActions.push({
            id: `act-comp-${idx}`,
            type: "compensation",
            title: "Начислить баллы / согласовать компенсацию",
            done: !!oldDoneMap["compensation"],
            open: true,
            compType,
            points,
            reason,
            approval
          });
          const ph = countPlaceholders(points) + countPlaceholders(reason) + countPlaceholders(approval);
          if (ph) warningsList.push(`Баллы: незаполненных плейсхолдеров ${ph}`);
        } else if (t === "ЗАДАЧА") {
          const target = (f.КОМУ || "").trim();
          const taskText = (f.ТЕКСТ || "").trim();
          const taskNo = (f.НОМЕР || "").trim();
          const done = oldTaskDones[taskIdx] !== undefined ? oldTaskDones[taskIdx] : false;
          taskIdx++;
          newActions.push({
            id: `act-task-${idx}-${Date.now()}`,
            type: "task",
            title: `Задача: ${target || "отдел"}`,
            done,
            open: true,
            target,
            text: taskText,
            taskNo
          });
          const ph = countPlaceholders(target) + countPlaceholders(taskText) + countPlaceholders(taskNo);
          if (ph) warningsList.push(`Задача: незаполненных плейсхолдеров ${ph}`);
        } else if (t === "ЗАКРЫТИЕ") {
          hasClosing = true;
          if (Array.isArray(f.КОММЕНТАРИЙ)) {
            closingCommentText = f.КОММЕНТАРИЙ.join("\n").trim();
          } else {
            closingCommentText = (f.КОММЕНТАРИЙ || "").trim();
          }
        } else {
          warningsList.push(`Неизвестное действие: ${t} (пропущено)`);
        }
      });

      // 3. «Закрыть тикет с комментарием» (всегда остаётся последним)
      newActions.push({
        id: "act-comment",
        type: "comment",
        title: "Закрыть тикет с комментарием",
        done: !!oldDoneMap["comment"] || !!oldDoneMap["service"],
        open: true,
        commentText: closingCommentText
      });
      if (!hasClosing) {
        warningsList.push("Действие ЗАКРЫТИЕ отсутствовало в ответе (не заполнено)");
      } else {
        const ph = countPlaceholders(closingCommentText);
        if (ph) warningsList.push(`Комментарий: незаполненных плейсхолдеров ${ph}`);
      }

      state.actions = newActions;

      // 4. Заполнение блока matching
      const matchingEl = $("matching-text");
      if (matchingEl) {
        matchingEl.value = parsed.matching || "";
        state.matchingText = parsed.matching || "";
      }

      const dict = await loadDictionary();
      if (parsed.matching && dict) {
        const matchWarnings = validateMatchingText(parsed.matching, dict);
        if (matchWarnings.length) {
          warningsList.push(...matchWarnings);
        }
      } else if (!parsed.matching) {
        warningsList.push("Блок МАТЧИНГ отсутствует в ответе");
      }

      updateMatchingUI(dict);

      // Сводка результатов разбора
      const createdCount = newActions.length;
      const removedCount = Math.max(0, prevCount - createdCount);
      const warningsCount = warningsList.length;

      const summaryText = `Создано пунктов: ${createdCount}, удалено: ${removedCount}, предупреждений: ${warningsCount}.` +
        (warningsList.length ? ` (${warningsList.join("; ")})` : "");

      state.lastParse4Summary = summaryText;

      if (msg) {
        msg.className = "hint msg ok";
        msg.textContent = summaryText;
      }

      // Сворачиваем помощника
      const h4 = $("helper4");
      if (h4) h4.open = false;

      save();
      renderActionCards();
      syncChecklistOut();
    });
  }

  // Блок сопоставления кейсов (matching textarea listener)
  const matchingTa = $("matching-text");
  if (matchingTa) {
    matchingTa.value = state.matchingText || "";
    matchingTa.addEventListener("input", async () => {
      state.matchingText = matchingTa.value;
      const dict = await loadDictionary();
      updateMatchingUI(dict);
      save();
    });
  }

  // Добавление нового действия вручную
  const addActionBtn = $("btn-add-action");
  if (addActionBtn) {
    addActionBtn.addEventListener("click", () => {
      const titleInput = $("new-action-title");
      const typeSelect = $("new-action-type");
      if (!titleInput) return;
      const customTitle = titleInput.value.trim();
      const type = typeSelect ? typeSelect.value : "call";

      if (!state.actions) state.actions = getDefaultActions();

      let newAct;
      const id = `act-${type}-${Date.now()}`;

      if (type === "call") {
        newAct = {
          id,
          type: "call",
          title: customTitle || "Звонок клиенту",
          done: false,
          open: true,
          time: "",
          script: ""
        };
      } else if (type === "chat") {
        newAct = {
          id,
          type: "chat",
          title: customTitle || "Ответить клиенту в чате (Tone of Voice)",
          done: false,
          open: true,
          text: ""
        };
      } else if (type === "compensation") {
        newAct = {
          id,
          type: "compensation",
          title: customTitle || "Начислить баллы / согласовать компенсацию",
          done: false,
          open: true,
          compType: "баллы",
          points: "",
          reason: "",
          approval: ""
        };
      } else if (type === "task") {
        newAct = {
          id,
          type: "task",
          title: customTitle || "Задача на внешний отдел / CTASK",
          done: false,
          open: true,
          target: "",
          text: "",
          taskNo: ""
        };
      } else if (type === "comment") {
        newAct = {
          id,
          type: "comment",
          title: customTitle || "Закрыть тикет с комментарием",
          done: false,
          open: true,
          commentText: ""
        };
      } else {
        newAct = {
          id,
          type: "custom",
          title: customTitle || "Новое действие",
          done: false,
          open: true,
          customText: ""
        };
      }

      // Вставляем перед последним элементом («Закрыть тикет»), если он есть
      const commentIdx = state.actions.findIndex(a => a.type === "comment" || a.type === "service");
      if (commentIdx !== -1) {
        state.actions.splice(commentIdx, 0, newAct);
      } else {
        state.actions.push(newAct);
      }

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
  onRender(4, async () => {
    renderActionCards();
    syncChecklistOut();
    const dict = await loadDictionary();
    updateMatchingUI(dict);
    updPh();
  });
}
