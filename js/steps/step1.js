// Шаг 1. Прочитать претензию: сборка промта step001 для DeepSeek, разбор ответа и валидация.

import { $, copyText } from "../ui.js";
import { save, state } from "../state.js";
import { goTo, onRender } from "../nav.js";
import { parseAnswer, NAMES } from "../parser.js";
import { parseClientUrl, rememberOrigin, updateCrmBar } from "../crm.js";

let promptTemplate = "";

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

/** Автоматическое сворачивание помощника при заполненном номере тикета */
export function updateHelperVisibility() {
  const helper = $("helper");
  if (!helper) return;
  const ticketVal = ($("ticket")?.value || "").trim();
  helper.open = !ticketVal;
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
  const clientUrlVal = ($("helper-client-url")?.value || $("client-url")?.value || "").trim() || "не указан";
  const chatVal = ($("helper-chat")?.value || "").trim() || "[Вставьте сюда текст переписки из WebCRM]";

  return promptTemplate
    .replace("{{DATETIME}}", readableDt)
    .replace("{{TICKET}}", ticketVal)
    .replace("{{CLIENT_URL}}", clientUrlVal)
    .replace("{{CHAT}}", chatVal);
}

export function updatePromptPreview() {
  const preview = $("prompt-text");
  if (preview && promptTemplate) {
    preview.textContent = buildAssembledPrompt();
  }
}

export function initStep1() {
  // Инициализация опорного времени по умолчанию, если пусто
  const dtInput = $("case-datetime");
  const helperDtInput = $("helper-datetime");
  const initDt = currentLocalDatetime();

  if (dtInput && !dtInput.value) dtInput.value = initDt;
  if (helperDtInput && !helperDtInput.value) helperDtInput.value = dtInput ? dtInput.value : initDt;

  const setNow = () => {
    const now = currentLocalDatetime();
    if (dtInput) dtInput.value = now;
    if (helperDtInput) helperDtInput.value = now;
    updatePromptPreview();
    save();
  };

  $("btn-case-now")?.addEventListener("click", setNow);
  $("btn-helper-now")?.addEventListener("click", setNow);

  // Синхронизация времени между блоком помощника и формой
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

  // Синхронизация номера тикета
  const ticketInput = $("ticket");
  const helperTicket = $("helper-ticket");
  if (ticketInput && helperTicket) {
    if (ticketInput.value && !helperTicket.value) helperTicket.value = ticketInput.value;
    else if (helperTicket.value && !ticketInput.value) ticketInput.value = helperTicket.value;

    ticketInput.addEventListener("input", () => {
      helperTicket.value = ticketInput.value;
      updatePromptPreview();
      updateCrmBar();
    });
    helperTicket.addEventListener("input", () => {
      ticketInput.value = helperTicket.value;
      updatePromptPreview();
      updateCrmBar();
      save();
    });
  }

  // Синхронизация адреса карточки клиента в CRM
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

  // Обновление предпросмотра при вводе текста чата
  $("helper-chat")?.addEventListener("input", () => {
    updatePromptPreview();
    save();
  });

  // Кнопка «Собрать промт step001 и скопировать»
  $("build-copy-prompt")?.addEventListener("click", async () => {
    if (!promptTemplate) await loadPrompt();
    if (!promptTemplate) return;

    // Синхронизируем и сохраняем поля
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

    // Подтягиваем тикет и CRM URL из помощника в форму
    if (helperTicket?.value && ticketInput) ticketInput.value = helperTicket.value.trim();
    if (helperClient?.value && clientInput) clientInput.value = helperClient.value.trim();

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

    const miss = Object.keys(NAMES).filter(k => !(k in res)).map(k => NAMES[k]);
    if (msg) {
      msg.textContent = "Заполнено: " + got.map(k => NAMES[k]).join(", ") + "." +
        (miss.length ? " Не найдено: " + miss.join(", ") + "." : "");
    }

    // Сворачиваем помощник после успешного разбора
    const helper = $("helper");
    if (helper) helper.open = false;

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

  // Первоначальная проверка сворачивания помощника
  updateHelperVisibility();
  updateClientUrlMsg();
  loadPrompt();

  // При каждом возврате на шаг 1 актуализируем состояние помощника
  onRender(1, () => {
    updateHelperVisibility();
    updateCrmBar();
  });
}
