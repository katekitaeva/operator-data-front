// Модуль работы с кейсами: сборка карточки, обезличивание (PII), отправка и загрузка из архива

import { $, val } from "./ui.js";
import { state, save } from "./state.js";
import { parseClientUrl, savedOrigin, updateCrmBar } from "./crm.js";
import { verdict } from "./steps/step1.js";
import { getThemesVersion } from "./steps/step2.js";
import { ghPut } from "./github.js";
import { getDefaultActions, syncChecklistOut } from "./steps/step4.js";

/** Парсинг текста блока сопоставления в структурированный JSON-объект */
export function parseMatchingTextToObject(text) {
  if (!text || typeof text !== "string") return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const obj = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z0-9_]+)\s*[:：]\s*(.*)$/);
    if (m) {
      obj[m[1].trim()] = m[2].trim();
    }
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

/** Форматирование объекта сопоставления обратно в текст для поля формы */
export function formatMatchingObjectToText(obj) {
  if (!obj || typeof obj !== "object") return "";
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

/** Обезличивание текста: удаление телефонов, email, паспортных данных и явных ФИО */
export function redactPii(text) {
  if (!text || typeof text !== "string") return text || "";
  let s = text;

  // Телефоны (+7..., 8..., международные)
  s = s.replace(/(?:\+?7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон]");
  s = s.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{2,4}\b/g, (m) => {
    // Не заменять короткие номера заказов, если в них меньше 10 цифр
    const digits = m.replace(/\D/g, "");
    return digits.length >= 10 ? "[телефон]" : m;
  });

  // Электронная почта
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");

  // Банковские карты (16 цифр)
  s = s.replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, "[номер карты]");

  // Паспорт РФ (серия и номер: 4 цифры + 6 цифр)
  s = s.replace(/\b\d{4}\s+\d{6}\b/g, "[паспорт]");

  // Явные упоминания ФИО после слов "клиент", "ФИО", "покупатель", "пользователь"
  s = s.replace(/(?:[Кк]лиент(?:ка)?|[Фф][Ии][Оо]|[Пп]окупател[ья]|[Пп]ользовател[ья])\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/gu, (m, name) => {
    return m.replace(name, "[ФИО]");
  });

  return s;
}

/** Обезличивание всей карточки кейса */
export function sanitizeCaseCard(card) {
  if (!card) return card;
  const clean = { ...card };

  if (clean.title) clean.title = redactPii(clean.title);
  clean.problem = redactPii(clean.problem);
  clean.demand = redactPii(clean.demand);
  if (clean.demandChanged) clean.demandChanged = redactPii(clean.demandChanged);
  if (clean.legal) clean.legal = redactPii(clean.legal);
  if (clean.contacts) clean.contacts = redactPii(clean.contacts);
  if (clean.tasks) clean.tasks = redactPii(clean.tasks);
  if (clean.chrono) clean.chrono = redactPii(clean.chrono);
  if (clean.status) clean.status = redactPii(clean.status);
  if (clean.whatWorked) clean.whatWorked = redactPii(clean.whatWorked);
  if (clean.qcComments) clean.qcComments = redactPii(clean.qcComments);
  if (clean.verdict) clean.verdict = redactPii(clean.verdict);
  if (clean.summary) clean.summary = redactPii(clean.summary);

  if (clean.outcome) {
    clean.outcome = {
      check: redactPii(clean.outcome.check || ""),
      reply: redactPii(clean.outcome.reply || ""),
      comment: redactPii(clean.outcome.comment || "")
    };
  }

  if (Array.isArray(clean.themes)) {
    clean.themes = clean.themes.map(t => ({
      ...t,
      note: redactPii(t.note || "")
    }));
  }

  if (Array.isArray(clean.actions)) {
    clean.actions = clean.actions.map(a => {
      const act = { ...a };
      if (act.title) act.title = redactPii(act.title);
      if (act.script) act.script = redactPii(act.script);
      if (act.text) act.text = redactPii(act.text);
      if (act.points && typeof act.points === "string") act.points = redactPii(act.points);
      if (act.reason) act.reason = redactPii(act.reason);
      if (act.approval) act.approval = redactPii(act.approval);
      if (act.target) act.target = redactPii(act.target);
      if (act.taskNo) act.taskNo = redactPii(act.taskNo);
      if (act.commentText) act.commentText = redactPii(act.commentText);
      if (act.customText) act.customText = redactPii(act.customText);
      return act;
    });
  }

  if (clean.matching && typeof clean.matching === "object") {
    const cleanMatching = {};
    for (const [k, v] of Object.entries(clean.matching)) {
      cleanMatching[k] = typeof v === "string" ? redactPii(v) : v;
    }
    clean.matching = cleanMatching;
  }

  return clean;
}

/** Сборка карточки из текущего состояния формы */
export function buildCaseCard() {
  const ticket = val("ticket").trim();
  const order = val("order").trim();
  const clientRef = parseClientUrl(val("client-url"));
  const clientId = (clientRef && clientRef.clientId) || (state.loadedCase && state.loadedCase.clientId) || null;

  const dtInput = (val("case-datetime") || "").trim();
  const dateFromInput = dtInput ? dtInput.slice(0, 10) : "";
  const date = dateFromInput || (state.loadedCase && state.loadedCase.date) || new Date().toISOString().slice(0, 10);
  const caseDatetime = dtInput || (state.loadedCase && state.loadedCase.caseDatetime) || null;
  const now = new Date().toISOString();

  const themes = (state.themes || []).map(t => ({
    path: t.path || "",
    status: t.status || "",
    note: t.note || ""
  }));

  const clientContext = {
    accruals: val("c-acc") !== "" ? Number(val("c-acc")) : null,
    orders: val("c-orders") !== "" ? Number(val("c-orders")) : null,
    cancels: val("c-cancels") !== "" ? Number(val("c-cancels")) : null,
    returns: val("c-returns") !== "" ? Number(val("c-returns")) : null,
    orderSum: val("c-sum") !== "" ? Number(val("c-sum")) : null,
    clientStatus: val("c-status").trim(),
    critical: {
      k1: !!($("k1") && $("k1").checked),
      k2: !!($("k2") && $("k2").checked)
    },
    labels: {
      l1: !!($("l1") && $("l1").checked),
      l2: !!($("l2") && $("l2").checked),
      l3: !!($("l3") && $("l3").checked),
      l4: !!($("l4") && $("l4").checked)
    }
  };

  const matchingText = (val("matching-text") || state.matchingText || "").trim();
  const matchingObj = parseMatchingTextToObject(matchingText);

  const card = {
    id: (state.loadedCase && state.loadedCase.id) || ticket || order || ("case_" + Date.now()),
    title: val("case-title").trim(),
    date,
    caseDatetime,
    createdAt: (state.loadedCase && state.loadedCase.createdAt) || now,
    updatedAt: now,
    ticket,
    order,
    clientId,
    clientUrl: val("client-url").trim() || null,
    themes,
    problem: val("problem").trim(),
    demand: val("demand").trim(),
    demandChanged: val("changed").trim() || null,
    legal: val("legal").trim() || null,
    contacts: val("contacts").trim() || null,
    tasks: val("tasks").trim() || null,
    chrono: val("chrono").trim() || null,
    status: val("status").trim() || null,
    clientContext,
    verdict: verdict(),
    actions: Array.isArray(state.actions) ? JSON.parse(JSON.stringify(state.actions)) : null,
    matching: matchingObj,
    dictionaryVersion: state.dictionaryVersion || null,
    outcome: {
      check: val("out-check").trim(),
      reply: val("out-reply").trim(),
      comment: val("out-comment").trim()
    },
    whatWorked: val("what-worked").trim(),
    qcComments: val("qc-comments").trim(),
    themesVersion: getThemesVersion(),
    isUpdated: !!state.loadedCase
  };

  // Сохраняем поля старого сопоставления при наличии для совместимости со старыми записями
  if (state.caseMatch) {
    if (state.caseMatch.problem) card.problemMatch = state.caseMatch.problem;
    if (state.caseMatch.demand) card.demandMatch = state.caseMatch.demand;
    if (state.caseMatch.solution) card.solution = state.caseMatch.solution;
    if (state.caseMatch.points !== undefined && state.caseMatch.points !== null) card.points = state.caseMatch.points;
    if (state.caseMatch.result) card.result = state.caseMatch.result;
    if (state.caseMatch.reasons) card.reasons = state.caseMatch.reasons;
    if (state.caseMatch.summary) card.summary = state.caseMatch.summary;
  }

  return sanitizeCaseCard(card);
}

/** Запись или обновление карточки в inbox/cases/ через GitHub API (PUT) */
export async function saveCaseCard(card) {
  if (!card) throw new Error("Нет данных карточки");
  
  const isUpdate = !!(state.loadedCase && state.loadedCase.file);
  const date = card.date || new Date().toISOString().slice(0, 10);
  const tag = (card.ticket || card.order || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = isUpdate ? state.loadedCase.file : `${date}_${tag}.json`;
  const path = `inbox/cases/${fileName}`;

  const jsonText = JSON.stringify(card, null, 2);
  const subject = card.title ? `«${card.title}»` : (card.ticket ? `тикет #${card.ticket}` : `заказ ${card.order}`);
  const commitMsg = (isUpdate ? "Обновление кейса: " : "Запись кейса: ") + subject;

  await ghPut(path, jsonText, commitMsg);

  // Фиксируем обновлённое состояние
  state.loadedCase = {
    id: card.id,
    file: fileName,
    title: card.title || "",
    date: card.date,
    createdAt: card.createdAt,
    clientId: card.clientId
  };
  state.caseSaved = true;
  save();

  return { ok: true, path, fileName, isUpdate };
}

/** Загрузка сохранённого кейса в форму со всеми полями шагов 1–5 */
export function loadCaseIntoForm(card, file) {
  if (!card) return false;

  const setVal = (id, v) => {
    const el = $(id);
    if (el) el.value = (v !== undefined && v !== null) ? v : "";
  };

  // Шаг 1: дата/время, тикет, заказ, поля претензии
  const loadedDt = card.caseDatetime || (card.date ? `${card.date}T12:00` : "");
  if (loadedDt) {
    setVal("case-datetime", loadedDt);
    setVal("helper-datetime", loadedDt);
  }
  setVal("ticket", card.ticket || "");
  setVal("helper-ticket", card.ticket || "");
  setVal("order", card.order || "");
  setVal("problem", card.problem || "");
  setVal("demand", card.demand || "");
  setVal("changed", card.demandChanged || "");
  setVal("legal", card.legal || "");
  setVal("contacts", card.contacts || "");
  setVal("tasks", card.tasks || "");

  // Шаг 2: хронология, статус
  setVal("chrono", card.chrono || "");
  setVal("status", card.status || "");

  // Шаг 3: показатели клиента и чекбоксы
  if (card.clientContext) {
    const cc = card.clientContext;
    if (cc.accruals !== undefined && cc.accruals !== null) setVal("c-acc", cc.accruals);
    if (cc.orders !== undefined && cc.orders !== null) setVal("c-orders", cc.orders);
    if (cc.cancels !== undefined && cc.cancels !== null) setVal("c-cancels", cc.cancels);
    if (cc.returns !== undefined && cc.returns !== null) setVal("c-returns", cc.returns);
    if (cc.orderSum !== undefined && cc.orderSum !== null) setVal("c-sum", cc.orderSum);
    if (cc.clientStatus) setVal("c-status", cc.clientStatus);

    if (cc.critical) {
      if ($("k1")) $("k1").checked = !!cc.critical.k1;
      if ($("k2")) $("k2").checked = !!cc.critical.k2;
    }
    if (cc.labels) {
      if ($("l1")) $("l1").checked = !!cc.labels.l1;
      if ($("l2")) $("l2").checked = !!cc.labels.l2;
      if ($("l3")) $("l3").checked = !!cc.labels.l3;
      if ($("l4")) $("l4").checked = !!cc.labels.l4;
    }
  }

  // Восстановление CRM ссылки
  if (card.clientUrl) {
    setVal("client-url", card.clientUrl);
    setVal("helper-client-url", card.clientUrl);
  } else {
    const origin = savedOrigin();
    if (origin && card.clientId) {
      const fullClientUrl = `${origin}/clients/${card.clientId}`;
      setVal("client-url", fullClientUrl);
      setVal("helper-client-url", fullClientUrl);
    }
  }

  // Темы в сохранённом порядке
  state.themes = (card.themes || []).map(t => {
    if (typeof t === "string") return { path: t, status: "подтверждено", note: "" };
    return {
      path: t.path || "",
      status: t.status || "подтверждено",
      note: t.note || ""
    };
  });

  // Шаг 4: Действия чеклиста
  if (Array.isArray(card.actions) && card.actions.length > 0) {
    // Новый формат: прямое восстановление всех действий
    state.actions = JSON.parse(JSON.stringify(card.actions));
  } else {
    // Старый формат (без actions):
    // Создаём базовые действия и переносим тексты из ответа и комментария
    const def = getDefaultActions();
    const replyText = (card.outcome && card.outcome.reply) || "";
    const commentText = (card.outcome && card.outcome.comment) || "";

    def.forEach(a => {
      if (a.type === "chat" && replyText) {
        a.text = replyText;
      } else if ((a.type === "comment" || a.type === "service") && commentText) {
        a.commentText = commentText;
      }
    });
    state.actions = def;
  }

  // Скрытые поля outcome
  if (card.outcome) {
    setVal("out-check", card.outcome.check || "");
    setVal("out-reply", card.outcome.reply || "");
    setVal("out-comment", card.outcome.comment || "");
  }

  // Шаг 4: Блок сопоставления кейсов (matching)
  if (card.matching) {
    if (typeof card.matching === "object" && !Array.isArray(card.matching)) {
      state.matchingText = formatMatchingObjectToText(card.matching);
    } else if (typeof card.matching === "string") {
      state.matchingText = card.matching;
    } else {
      state.matchingText = "";
    }
    setVal("matching-text", state.matchingText);
    state.dictionaryVersion = card.dictionaryVersion || null;
  } else {
    state.matchingText = "";
    setVal("matching-text", "");
    state.dictionaryVersion = null;
  }

  // Сохраняем старый caseMatch для совместимости при наличии
  if (card.problemMatch || card.demandMatch || card.solution || card.result || card.reasons || card.summary) {
    state.caseMatch = {
      problem: card.problemMatch || null,
      demand: card.demandMatch || null,
      solution: card.solution || null,
      points: card.points !== undefined ? card.points : null,
      result: card.result || null,
      reasons: card.reasons || null,
      summary: card.summary || null
    };
  } else {
    state.caseMatch = null;
  }

  // Шаг 5
  setVal("case-title", card.title || "");
  setVal("what-worked", card.whatWorked || "");
  setVal("qc-comments", card.qcComments || "");

  // Запоминаем идентификатор загруженного кейса
  state.loadedCase = {
    id: card.id || card.ticket || card.order,
    file: file || card.file || `${card.date || new Date().toISOString().slice(0, 10)}_${card.ticket || card.order}.json`,
    title: card.title || "",
    date: card.date || "",
    createdAt: card.createdAt || "",
    clientId: card.clientId || null
  };
  state.caseSaved = true;

  updateCrmBar();
  syncChecklistOut();
  save();
  return true;
}
