// Ссылки на CRM (o3team.ru).
// Шаблоны:
// ТИКЕТ:  https://crm.o3team.ru/tickets/<номер тикета>
// КЛИЕНТ: https://crm.o3team.ru/clients/<идентификатор клиента>
// ЗАКАЗ:  https://crm.o3team.ru/clients/<идентификатор клиента>/orders/<номер заказа>

import { CRM_TABS } from "./config.js";

const DEFAULT_ORIGIN = "https://crm.o3team.ru";
const KEY = "operator-crm";
const field = () => document.getElementById("client-url");

/** Разбор адреса или ID карточки: { origin, clientId|null } */
export function parseClientUrl(raw) {
  const val = (raw || "").trim();
  if (!val) return null;

  try {
    const u = new URL(val);
    if (/^https?:$/.test(u.protocol)) {
      const m = u.pathname.match(/\/clients\/([^/?#]+)/);
      return {
        origin: u.origin,
        clientId: m ? decodeURIComponent(m[1]) : null
      };
    }
  } catch (e) {
    // Не является полным URL: если это простой идентификатор (буквенно-цифровой), трактуем как clientId
    if (/^[a-zA-Z0-9_-]+$/.test(val)) {
      return { origin: savedOrigin() || DEFAULT_ORIGIN, clientId: val };
    }
  }
  return null;
}

export function rememberOrigin(origin) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ origin }));
  } catch (e) {}
}

export function savedOrigin() {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "null") || {}).origin || DEFAULT_ORIGIN;
  } catch (e) {
    return DEFAULT_ORIGIN;
  }
}

/** Хост и ID клиента. Приоритет хоста: из введённого URL -> из памяти -> DEFAULT_ORIGIN */
export function crmContext() {
  const ref = parseClientUrl(field() ? field().value : "");
  const origin = (ref && ref.origin) || savedOrigin() || DEFAULT_ORIGIN;
  const clientId = ref ? ref.clientId : null;
  return { origin, clientId };
}

/** Ссылка на тикет: https://crm.o3team.ru/tickets/<n> */
export function ticketUrl(n) {
  const clean = (n || "").trim();
  if (!clean) return null;
  const { origin } = crmContext();
  return `${origin}/tickets/${encodeURIComponent(clean)}`;
}

/** Ссылка на карточку клиента: https://crm.o3team.ru/clients/<clientId> */
export function clientUrl(id) {
  const { origin, clientId } = crmContext();
  const cId = (id || clientId || "").trim();
  if (!cId) return null;
  return `${origin}/clients/${encodeURIComponent(cId)}`;
}

/** Ссылка на заказ клиента: https://crm.o3team.ru/clients/<clientId>/orders/<n> */
export function orderUrl(n) {
  const clean = (n || "").trim();
  if (!clean) return null;
  const { origin, clientId } = crmContext();
  if (!clientId) return null;
  return `${origin}/clients/${encodeURIComponent(clientId)}/orders/${encodeURIComponent(clean)}`;
}

/** Вкладки карточки клиента: [[название, адрес], …] */
export function tabUrls() {
  const { origin, clientId } = crmContext();
  if (!origin || !clientId) return null;
  const base = `${origin}/clients/${encodeURIComponent(clientId)}`;
  return CRM_TABS.map(([name, path]) => [name, path ? `${base}/${path}` : base]);
}

/** Обновление верхнего сквозного CRM-меню (отображается на всех шагах) */
export function updateCrmBar() {
  const bar = document.getElementById("crm-top-bar");
  const linksBox = document.getElementById("crm-bar-links");
  if (!bar || !linksBox) return;

  const ticketVal = (document.getElementById("ticket")?.value || "").trim();
  const orderVal = (document.getElementById("order")?.value || "").trim();
  const clientInput = (document.getElementById("client-url")?.value || "").trim();
  const { clientId } = crmContext();

  const links = [];

  if (ticketVal) {
    const tUrl = ticketUrl(ticketVal);
    if (tUrl) {
      links.push(`
        <a class="crm-link-pill" href="${tUrl}" target="_blank" rel="noopener" title="Открыть тикет #${ticketVal} в CRM">
          <span class="crm-pill-icon">🎫</span>
          <span class="crm-pill-type">Тикет:</span>
          <strong>#${ticketVal}</strong>
          <span class="crm-ext">↗</span>
        </a>
      `);
    }
  }

  if (clientId) {
    const cUrl = clientUrl(clientId);
    if (cUrl) {
      links.push(`
        <a class="crm-link-pill" href="${cUrl}" target="_blank" rel="noopener" title="Открыть карточку клиента в CRM">
          <span class="crm-pill-icon">👤</span>
          <span class="crm-pill-type">Клиент:</span>
          <strong>${clientId}</strong>
          <span class="crm-ext">↗</span>
        </a>
      `);
    }
  }

  if (orderVal) {
    if (clientId) {
      const oUrl = orderUrl(orderVal);
      if (oUrl) {
        links.push(`
          <a class="crm-link-pill" href="${oUrl}" target="_blank" rel="noopener" title="Открыть заказ ${orderVal} в CRM">
            <span class="crm-pill-icon">📦</span>
            <span class="crm-pill-type">Заказ:</span>
            <strong>${orderVal}</strong>
            <span class="crm-ext">↗</span>
          </a>
        `);
      }
    } else {
      links.push(`
        <span class="crm-link-pill disabled" title="Укажите ссылку на карточку клиента, чтобы активировать прямую ссылку на заказ">
          <span class="crm-pill-icon">📦</span>
          <span class="crm-pill-type">Заказ:</span>
          <strong>${orderVal}</strong>
          <span class="crm-pill-note">(нет ссылки клиента)</span>
        </span>
      `);
    }
  }

  if (links.length > 0) {
    linksBox.innerHTML = links.join("");
    bar.hidden = false;
  } else {
    linksBox.innerHTML = "";
    bar.hidden = true;
  }
}
