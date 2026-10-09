// Шаг 1. Суть и контекст: сборка промта step001 для DeepSeek, разбор ответа,
// оценка контекста клиента по «Памятке» Loyalty и расчет вердикта.

import { $, val, num, copyText } from "../ui.js";
import { save, state } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { parseAnswer, NAMES } from "../parser.js";
import { parseClientUrl, rememberOrigin, updateCrmBar } from "../crm.js";
import { getArchiveCases, loadCaseByFile } from "../case-loader.js";

let promptTemplate = "";
let dismissedTicket = null;
let ticketCheckTimer = null;

export function currentLocalDatetime() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function updateClientUrlMsg() {
  const msg = $("client-url-msg");
  if (!msg) return;
  const raw = ($("client-url")?.value || "").trim();
  if (!raw) { msg.textContent = ""; return; }
  const ref = parseClientUrl(raw);
  if (!ref) { msg.textContent = "Не похоже на адрес. Нужен адрес вида https://…/clients/…"; return; }
  rememberOrigin(ref.origin);
  msg.textContent = ref.clientId ? "Ссылки на тикет и заказ включены." : "Ссылка на тикет включена. В адресе нет /clients/…, поэтому ссылка на заказ не строится.";
}

/** Сброс состояния проверки тикета в архиве (вызывается при начале новой претензии) */
export function resetTicketArchiveCheck() {
  dismissedTicket = null;
  clearTimeout(ticketCheckTimer);
  const b1 = $("ticket-found-banner");
  if (b1) b1.style.display = "none";
  const b2 = $("helper-ticket-found-banner");
  if (b2) b2.style.display = "none";
}

/** Проверка, есть ли введённый номер тикета в базе сохранённых кейсов */
export async function checkTicketInArchive(rawTicket) {
  const clean = (rawTicket || "").trim();
  const b1 = $("ticket-found-banner");
  const b2 = $("helper-ticket-found-banner");
  const t1 = $("ticket-found-title");
  const t2 = $("helper-ticket-found-title");

  const hideBanners = () => {
    if (b1) b1.style.display = "none";
    if (b2) b2.style.display = "none";
  };

  if (!clean || clean.length < 3) {
    hideBanners();
    return;
  }

  // Если этот кейс уже загружен сейчас в форму, повторно не предлагаем
  if (state.loadedCase && String(state.loadedCase.ticket || "").trim() === clean) {
    hideBanners();
    return;
  }

  // Если оператор уже отказался от загрузки этого конкретного номера
  if (dismissedTicket === clean) {
    hideBanners();
    return;
  }

  const cases = await getArchiveCases();
  if (!cases || !cases.length) {
    hideBanners();
    return;
  }

  const found = cases.find(c => {
    const ct = String(c.ticket || "").trim();
    return ct && ct === clean;
  });

  if (!found) {
    hideBanners();
    return;
  }

  let caseTitle = (found.title || "").trim();
  if (!caseTitle) {
    caseTitle = found.order ? `Заказ ${found.order}` : `Тикет #${found.ticket}`;
  }

  if (t1) t1.textContent = `«${caseTitle}»`;
  if (t2) t2.textContent = `«${caseTitle}»`;

  if (b1) b1.style.display = "flex";
  if (b2) b2.style.display = "flex";

  const handleLoad = async () => {
    hideBanners();
    try {
      await loadCaseByFile(found.file);
      const parseMsg = $("parse-msg");
      if (parseMsg) {
        parseMsg.className = "hint msg ok";
        parseMsg.textContent = `Кейс «${caseTitle}» успешно загружен из архива!`;
      }
    } catch (e) {
      alert(`Ошибка при загрузке кейса: ${e.message}`);
    }
  };

  const handleDismiss = () => {
    dismissedTicket = clean;
    hideBanners();
  };

  const btnLoad = $("btn-load-found-ticket");
  const btnDismiss = $("btn-dismiss-found-ticket");
  const btnHelperLoad = $("btn-helper-load-found-ticket");
  const btnHelperDismiss = $("btn-helper-dismiss-found-ticket");

  if (btnLoad) btnLoad.onclick = handleLoad;
  if (btnHelperLoad) btnHelperLoad.onclick = handleLoad;
  if (btnDismiss) btnDismiss.onclick = handleDismiss;
  if (btnHelperDismiss) btnHelperDismiss.onclick = handleDismiss;
}

/** Автоматическое сворачивание помощника (только при явном разборе ответа) */
export function updateHelperVisibility() {
  // Намеренно не сворачиваем помощник автоматически при навигации:
  // оператору требуется открытый помощник на новом разборе
}

export function calcLoyaltyNorms() {
  const sum = num("c-sum") ?? 0;
  const acc = num("c-acc") ?? 0;
  const orders = num("c-orders") ?? 0;
  const cancels = num("c-cancels") ?? 0;
  const cancelsPct = orders > 0 ? Math.round((cancels / orders) * 100) : 0;

  const accOk = acc <= 3;
  const cancelsOk = cancelsPct <= 50;
  const crit = ["k1", "k2"].some(i => $(i)?.checked);
  const labs = [
    ["l1", "«фрод: злоупотребляет»"],
    ["l2", "«хамит, ругается»"],
    ["l3", "«бан купонов»"],
    ["l4", "«комментарии от др. подразделений»"]
  ].filter(x => $(x[0])?.checked).map(x => x[1]);
  const labsOk = labs.length === 0;

  const match = accOk && cancelsOk && labsOk;
  return { sum, acc, orders, cancels, cancelsPct, accOk, cancelsOk, crit, labs, labsOk, match };
}

/** Расчет вердикта по Памятке Loyalty */
export function verdict() {
  const { sum, acc, orders, cancels, cancelsPct, accOk, cancelsOk, crit, labs, labsOk, match } = calcLoyaltyNorms();
  const status = val("c-status") || "Обычный";

  const rows = [
    ["начисления за 2 месяца: " + acc + " (норма до 3)", accOk],
    ["метки: " + (labs.length ? labs.join(", ") : "негативных нет (в норме)"), labsOk],
    ["заказов: " + orders + ", отменено: " + cancels + " → отмены " + cancelsPct + "% (норма не более 50%)", cancelsOk]
  ];

  const lines = [
    "Ситуация " + (crit ? "критичная" : "некритичная") + ". Клиент " + (match ? "соответствует критериям." : "не соответствует критериям.")
  ];

  rows.forEach(r => lines.push("- " + r[0] + ": " + (r[1] ? "в норме" : "вне нормы")));
  lines.push("Стоимость заказа: " + sum + " ₽ (компенсация не больше стоимости заказа).");
  lines.push("Статус и доходность: " + status + ".");

  if (crit && match) {
    lines.push("По Памятке: Ситуация критичная, клиент надежный. Индивидуальные решения, компенсация в пределах стоимости заказа (" + sum + " ₽).");
  } else if (!crit && match) {
    lines.push("По Памятке: Ситуация некритичная, но клиент надежный. Решение по стандартным инструкциям. При необходимости компенсации — в пределах стоимости заказа (" + sum + " ₽).");
  } else if (crit && !match) {
    lines.push("По Памятке: Ситуация критичная, но клиент вне нормы. Минимальная или символическая компенсация, при сомнениях посоветуйтесь с РГ.");
  } else {
    lines.push("По Памятке: Стандартные решения без компенсации или с минимальной суммой.");
  }

  return lines.join("\n");
}

export function renderVerdict() {
  const { acc, cancelsPct, accOk, cancelsOk, crit, match } = calcLoyaltyNorms();

  // Обновление значения и бейджей числовых норм
  const calcPctEl = $("calc-cancels-pct");
  if (calcPctEl) calcPctEl.textContent = cancelsPct + "%";

  const bAcc = $("badge-acc");
  if (bAcc) {
    bAcc.textContent = accOk ? "✓" : "!";
    bAcc.title = accOk ? "В норме (до 3 начислений)" : "Выше нормы (более 3 начислений)";
    bAcc.setAttribute("aria-label", accOk ? "В норме" : "Выше нормы");
    bAcc.className = "norm-badge " + (accOk ? "ok" : "bad");
  }

  const bCan = $("badge-cancels");
  if (bCan) {
    bCan.textContent = cancelsOk ? "✓" : "!";
    bCan.title = cancelsOk ? "В норме (до 50% отмен)" : "Выше нормы (более 50% отмен)";
    bCan.setAttribute("aria-label", cancelsOk ? "В норме" : "Выше нормы");
    bCan.className = "norm-badge " + (cancelsOk ? "ok" : "bad");
  }

  // Обновление верхних бейджей вердикта
  const vCrit = $("vbadge-crit");
  if (vCrit) {
    vCrit.textContent = crit ? "⚠ Критичная ситуация" : "✔ Некритичная ситуация";
    vCrit.className = "vbadge " + (crit ? "warn" : "ok");
  }

  const vNorm = $("vbadge-norm");
  if (vNorm) {
    vNorm.textContent = match ? "✔ Клиент в норме" : "✖ Клиент вне нормы";
    vNorm.className = "vbadge " + (match ? "ok" : "warn");
  }

  const vBox = $("verdict");
  if (vBox) vBox.textContent = verdict();
}

/** Текстовое описание контекста Loyalty для подстановки в промт DeepSeek */
export function buildLoyaltyContextText() {
  const { sum, acc, orders, cancels, cancelsPct, accOk, cancelsOk, crit, labs } = calcLoyaltyNorms();
  const status = val("c-status") || "Обычный";

  return [
    `• Стоимость заказа: ${sum} ₽`,
    `• Начисления за 2 месяца: ${acc} (${accOk ? "в норме" : "вне нормы, норма до 3"})`,
    `• Заказов всего: ${orders}, отменено: ${cancels} (процент отмен: ${cancelsPct}%, ${cancelsOk ? "в норме" : "вне нормы, норма до 50%"})`,
    `• Статус и доходность: ${status}`,
    `• Критичность: ${crit ? "Критичная ситуация (триггеры из Памятки)" : "Некритичная ситуация"}`,
    `• Метки CRM: ${labs.length ? labs.join(", ") : "негативных меток нет"}`
  ].join("\n");
}

export async function loadPrompt() {
  const st = $("prompt-state");
  try {
    const r = await fetch("prompts/step001.md", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    promptTemplate = await r.text();
    updatePromptPreview();
  } catch (e) {
    if (st) st.textContent = "Не удалось загрузить prompts/step001.md.";
  }
}

export function buildAssembledPrompt() {
  if (!promptTemplate) return "";
  const dtVal = $("case-datetime")?.value || $("helper-datetime")?.value || currentLocalDatetime();
  const readableDt = dtVal.replace("T", " ");
  const ticketVal = ($("helper-ticket")?.value || $("ticket")?.value || "").trim() || "не указан";
  const clientInputVal = ($("helper-client-url")?.value || $("client-url")?.value || "").trim();
  const clientRef = parseClientUrl(clientInputVal);
  const clientIdVal = (clientRef && clientRef.clientId) || (clientInputVal && !clientInputVal.startsWith("http") ? clientInputVal : "не указан");
  const clientUrlVal = (clientRef && clientRef.clientId && clientRef.origin ? `${clientRef.origin}/clients/${clientRef.clientId}` : (clientInputVal || "не указан"));
  const chatVal = ($("helper-chat")?.value || "").trim() || "[Вставьте сюда текст переписки из WebCRM]";
  const loyaltyText = buildLoyaltyContextText();

  return promptTemplate
    .replace("{{DATETIME}}", readableDt)
    .replace("{{TICKET}}", ticketVal)
    .replace("{{CLIENT_ID}}", clientIdVal)
    .replace("{{CLIENT_URL}}", clientUrlVal)
    .replace("{{LOYALTY_CONTEXT}}", loyaltyText)
    .replace("{{CHAT}}", chatVal);
}

export function updatePromptPreview() {
  const preview = $("prompt-text");
  if (preview && promptTemplate) {
    preview.textContent = buildAssembledPrompt();
  }
}

export function initStep1() {
  // Инициализация опорного времени по умолчанию
  const dtInput = $("case-datetime");
  const helperDtInput = $("helper-datetime");
  const initDt = currentLocalDatetime();

  if (dtInput && !dtInput.value) dtInput.value = initDt;
  if (helperDtInput && !helperDtInput.value) helperDtInput.value = dtInput ? dtInput.value : initDt;

  const setNow = (e) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = currentLocalDatetime();
    if (dtInput) dtInput.value = now;
    if (helperDtInput) helperDtInput.value = now;
    const btn = e?.currentTarget;
    if (btn) {
      const origText = btn.textContent;
      btn.textContent = "✓ Задано";
      btn.classList.add("pri");
      setTimeout(() => {
        btn.textContent = origText;
        btn.classList.remove("pri");
      }, 1200);
    }
    updatePromptPreview();
    save();
  };

  $("btn-case-now")?.addEventListener("click", setNow);
  $("btn-helper-now")?.addEventListener("click", setNow);

  // Синхронизация времени
  dtInput?.addEventListener("input", () => {
    if (helperDtInput) helperDtInput.value = dtInput.value;
    updatePromptPreview();
    save();
  });
  helperDtInput?.addEventListener("input", () => {
    if (dtInput) dtInput.value = helperDtInput.value;
    updatePromptPreview();
    save();
  });

  // Синхронизация номера тикета и мгновенная проверка в архиве кейсов
  const ticketInput = $("ticket");
  const helperTicket = $("helper-ticket");
  if (ticketInput && helperTicket) {
    if (ticketInput.value && !helperTicket.value) helperTicket.value = ticketInput.value;
    else if (helperTicket.value && !ticketInput.value) ticketInput.value = helperTicket.value;

    const onTicketChange = (val) => {
      if (dismissedTicket && dismissedTicket !== val.trim()) {
        dismissedTicket = null;
      }
      clearTimeout(ticketCheckTimer);
      ticketCheckTimer = setTimeout(() => {
        checkTicketInArchive(val);
      }, 250);
    };

    ticketInput.addEventListener("input", () => {
      helperTicket.value = ticketInput.value;
      updatePromptPreview();
      updateCrmBar();
      onTicketChange(ticketInput.value);
    });
    helperTicket.addEventListener("input", () => {
      ticketInput.value = helperTicket.value;
      updatePromptPreview();
      updateCrmBar();
      save();
      onTicketChange(helperTicket.value);
    });

    // Первичная проверка, если номер уже есть в поле
    if (ticketInput.value) {
      setTimeout(() => checkTicketInArchive(ticketInput.value), 400);
    }
  }

  // Синхронизация адреса/ID клиента
  const clientInput = $("client-url");
  const helperClient = $("helper-client-url");
  if (clientInput && helperClient) {
    if (clientInput.value && !helperClient.value) helperClient.value = clientInput.value;
    else if (helperClient.value && !clientInput.value) clientInput.value = helperClient.value;

    clientInput.addEventListener("input", () => {
      helperClient.value = clientInput.value;
      updateClientUrlMsg();
      updatePromptPreview();
      updateCrmBar();
    });
    helperClient.addEventListener("input", () => {
      clientInput.value = helperClient.value;
      updateClientUrlMsg();
      updatePromptPreview();
      updateCrmBar();
      save();
    });
  }

  $("helper-chat")?.addEventListener("input", () => {
    updatePromptPreview();
    save();
  });

  // Переключатели статуса клиента
  document.querySelectorAll(".status-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const stEl = $("c-status");
      if (stEl) stEl.value = btn.dataset.val;
      renderVerdict();
      updatePromptPreview();
      save();
    });
  });

  // Восстановление активной кнопки статуса
  const savedSt = val("c-status");
  if (savedSt) {
    document.querySelectorAll(".status-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.val === savedSt);
    });
  }

  // Слушатели на все поля Loyalty
  ["c-sum", "c-acc", "c-orders", "c-cancels"].forEach(id => {
    $(id)?.addEventListener("input", () => {
      renderVerdict();
      updatePromptPreview();
      save();
    });
  });

  ["k1", "k2", "l1", "l2", "l3", "l4"].forEach(id => {
    $(id)?.addEventListener("change", () => {
      renderVerdict();
      updatePromptPreview();
      save();
    });
  });

  // Копирование вердикта
  $("copy-verdict-btn")?.addEventListener("click", async () => {
    const ok = await copyText(verdict());
    const btn = $("copy-verdict-btn");
    if (btn) {
      const orig = btn.innerHTML;
      btn.textContent = ok ? "Скопировано! ✅" : "Ошибка ⚠️";
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  });

  // Кнопка «Собрать промт step001 и скопировать»
  $("build-copy-prompt")?.addEventListener("click", async () => {
    if (!promptTemplate) await loadPrompt();
    if (!promptTemplate) return;

    if (helperTicket?.value && ticketInput) ticketInput.value = helperTicket.value.trim();
    if (helperClient?.value && clientInput) clientInput.value = helperClient.value.trim();
    updateClientUrlMsg();
    updateCrmBar();
    save();

    const assembled = buildAssembledPrompt();
    updatePromptPreview();

    const ok = await copyText(assembled);
    const st = $("prompt-state");
    if (st) {
      st.textContent = ok ? "Промт собран и скопирован! Вставьте в DeepSeek ✅" : "Не удалось скопировать ⚠️";
      setTimeout(() => { st.textContent = ""; }, 3000);
    }
  });

  // Кнопка «Разобрать ответ и заполнить поля»
  $("parse")?.addEventListener("click", () => {
    const msg = $("parse-msg");
    const rawAnswer = $("answer")?.value || "";
    const res = parseAnswer(rawAnswer);
    const got = Object.keys(res);

    if (helperTicket?.value && ticketInput && !ticketInput.value) ticketInput.value = helperTicket.value.trim();
    if (helperClient?.value && clientInput && !clientInput.value) clientInput.value = helperClient.value.trim();

    if (!got.length) {
      if (msg) msg.textContent = "Не нашёл меток ЗАКАЗ:, ПРОБЛЕМА:, ТРЕБОВАНИЕ: и других. Вставьте ответ DeepSeek целиком.";
      return;
    }

    got.forEach(k => {
      const el = $(k);
      if (el) {
        el.value = res[k];
        el.classList.remove("invalid");
      }
    });

    // Если клиент указан в ответе, синхронизируем в helperClient
    if (res["client-url"] && helperClient && !helperClient.value) {
      helperClient.value = res["client-url"];
    }

    const miss = Object.keys(NAMES).filter(k => !(k in res)).map(k => NAMES[k]);
    if (msg) {
      msg.textContent = "Заполнено: " + got.map(k => NAMES[k]).join(", ") + "." +
        (miss.length ? " Не найдено: " + miss.join(", ") + "." : "");
    }

    // Сворачиваем помощник DeepSeek после разбора
    const helper = $("helper");
    if (helper) helper.open = false;

    renderVerdict();
    updateClientUrlMsg();
    updateCrmBar();
    save();
  });

  // Кнопка перехода к шагу 2
  $("next-1")?.addEventListener("click", () => {
    const err = $("err-1");
    const required = ["ticket", "order", "demand"];
    let empty = false;
    required.forEach(id => {
      const el = $(id);
      const bad = !el || !el.value.trim();
      if (el) el.classList.toggle("invalid", bad);
      if (bad) empty = true;
    });
    if (empty) {
      if (err) err.textContent = "Заполните номер тикета, номер заказа и требование клиента.";
      return;
    }
    if (err) err.textContent = "";
    goTo(2);
  });

  renderVerdict();
  updateHelperVisibility();
  updateClientUrlMsg();
  loadPrompt();

  onRender(1, () => {
    renderVerdict();
    updateHelperVisibility();
    updateCrmBar();
  });
}
