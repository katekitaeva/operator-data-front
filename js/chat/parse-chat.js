// Разбор HTML-выгрузки чата CRM в структурированные данные. Без обращений к странице:
// работает на любом DOMParser (в браузере глобальный, в тестах передаётся из jsdom).
//
// Результат: { clientId, clientName, messages[], events[], tasks[], orders[], delimiters[], stats }
// Все выводы делает код по разметке, DeepSeek для этого не нужен.

const ORDER_RE = /\b\d{6,9}-\d{4}\b/g;
const norm = s => s.replace(/\s+/g, " ").trim();

function dmyToIso(dmy) {            // "25.09.2026" → "2026-09-25"
  const m = (dmy || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function orderFromHref(href) {      // /clients/<клиент>/orders/<заказ>[/delivery?shipmentId=<id>]
  const m = (href || "").match(/\/clients\/([^/]+)\/orders\/([^/?#]+)(?:\/delivery\?shipmentId=(\d+))?/);
  return m ? { clientId: m[1], orderNo: m[2], shipmentId: m[3] || null } : null;
}

function blockText(contentEl) {
  const c = contentEl.cloneNode(true);
  c.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  c.querySelectorAll("div, p, li, ul, ol").forEach(b => b.append("\n"));   // блоки не должны слипаться
  const lines = c.textContent.split("\n").map(norm).filter(Boolean);
  return lines.join("\n");
}

export function parseChat(html, opts = {}) {
  const DP = opts.DOMParser || globalThis.DOMParser;
  const doc = new DP().parseFromString(html, "text/html");
  const root = doc.querySelector('[data-qa-id="chat-dialog.chat.messages-list"]') || doc.body || doc;
  const nodes = root.querySelectorAll(".chat-message, .chat-messages__delimiter, .chat-messages__previous-text, .chat-list__status-log__row");

  const messages = [], events = [], delimiters = [], orderHits = [];
  let dateHdr = null, zone = 0, currentTask = null, lastAuthor = null, lastRole = null;

  for (const el of nodes) {
    const cl = el.classList;

    if (cl.contains("chat-messages__previous-text")) { dateHdr = dmyToIso(el.textContent); continue; }
    if (cl.contains("chat-messages__delimiter")) {
      zone++;
      delimiters.push({ at: messages.length, kind: /Предыдущ/i.test(el.textContent) ? "previous" : "next" });
      continue;
    }

    if (cl.contains("chat-list__status-log__row")) {          // журнал: задача создана/закрыта, выбор упаковки
      const txt = norm(el.querySelector(".chat-list__status-log__item")?.textContent || "");
      const when = norm(el.querySelector(".chat-list__status-log__item-with-dot")?.textContent || "");
      const dm = when.match(/(\d{2}\.\d{2}\.\d{4}) в (\d{2}:\d{2})/);
      const ts = dm ? `${dmyToIso(dm[1])}T${dm[2]}` : null;
      const href = el.querySelector("a")?.getAttribute("href") || "";
      const ticketId = (href.match(/\/tickets\/(\d+)/) || [])[1] || null;
      let type = "other";
      if (el.querySelector("[data-message-ticket-start]") || /Создана задача/i.test(txt)) type = "ticket-created";
      else if (/закрыта/i.test(txt)) type = "ticket-closed";
      else if (/выбрал/i.test(txt)) type = "order-selected";
      const ev = { type, ts, text: txt, ticketId, afterMessage: messages.length, orderNo: null, clientId: null, shipmentId: null };
      if (type === "order-selected") {
        const o = orderFromHref(href);
        if (o) { Object.assign(ev, o); orderHits.push({ ...o, via: "log-selected", ts, msgId: null }); }
      }
      if (type === "ticket-created") currentTask = ticketId;
      if (type === "ticket-closed") currentTask = null;
      events.push(ev);
      continue;
    }

    // обычная реплика
    const content = el.querySelector(".chat-message__content");
    const id = ((content?.getAttribute("data-qa-id") || "").match(/message\.(\d+)$/) || [])[1] || null;
    const authorEl = el.querySelector(".chat-message__author-name, .chat-message__author-link");
    let author = authorEl ? norm(authorEl.textContent) : null;
    const staffId = (el.querySelector("a.chat-message__author-link")?.getAttribute("href") || "").match(/\/users\/(\d+)/)?.[1] || null;
    const klass = cl.contains("chat-message_client") ? "client" : cl.contains("chat-message_bot") ? "bot" : cl.contains("chat-message_interlocutor") ? "staff" : "unknown";
    if (!author && cl.contains("chat-message_same-type") && lastRole === klass) author = lastAuthor;   // продолжение серии: автор указан только у первой реплики
    const role = klass === "bot" && author && /WebCRM|Сервис/i.test(author) ? "system" : klass;
    lastAuthor = author; lastRole = klass;

    const time = norm(el.querySelector(".chat-message__date")?.textContent || "") || null;
    const blocks = el.querySelector(".chat-message-content-blocks");
    const text = blocks ? blockText(blocks) : "";

    const links = [], files = [], msgOrders = [];
    blocks?.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (a.classList.contains("order-data-button__action")) {
        const o = orderFromHref(href);
        if (o) msgOrders.push(o);
      } else if (!a.classList.contains("attachment__image-link")) links.push({ text: norm(a.textContent), href });
    });
    blocks?.querySelectorAll(".attachment").forEach(a => {
      const link = a.querySelector("a.attachment__image-link");
      files.push({ name: a.querySelector("img")?.getAttribute("alt") || (link?.getAttribute("href") || "").split("/").pop() || "файл" });
    });

    const m = {
      seq: messages.length + 1, id, role, author, staffId,
      date: dateHdr, time, ts: dateHdr && time ? `${dateHdr}T${time}` : null,
      text, links, files, orders: msgOrders.map(o => o.orderNo),
      taskId: currentTask, zone, ticketAttr: el.getAttribute("data-message-ticket-id") || null,
      kind: "text"
    };
    messages.push(m);

    msgOrders.forEach(o => orderHits.push({ ...o, via: role === "client" ? "client-button" : "template-example", ts: m.ts, msgId: id }));
    for (const num of text.match(ORDER_RE) || []) {
      if (!msgOrders.some(o => o.orderNo === num)) orderHits.push({ orderNo: num, clientId: null, shipmentId: null, via: role + "-text", ts: m.ts, msgId: id });
    }
  }

  // --- классификация шума (только пометки, ничего не удаляем) ---
  const name = (messages.find(m => m.role === "bot" && /^Здравствуйте,\s+.+!$/.test(m.text))?.text.match(/^Здравствуйте,\s+(.+?)!$/) || [])[1] || null;
  const freq = {};
  messages.forEach(m => { if (m.role === "bot") freq[m.text] = (freq[m.text] || 0) + 1; });
  messages.forEach((m, i) => {
    if (!m.text && m.files.length) m.kind = "attachment";
    else if (m.role === "client" && m.orders.length) m.kind = "order-select";
    else if (m.role === "bot" && (freq[m.text] > 1 || /^Здравствуйте,\s+.+!$/.test(m.text))) m.kind = "boilerplate";
    else if (m.role === "client" && m.text && m.text.split(" ").length <= 6 && !/[?]/.test(m.text)) {
      const prev = messages[i - 1], next = messages[i + 1];
      if (prev?.role === "bot" && next?.role === "bot" && next.ts && next.ts === m.ts) m.kind = "menu-click";
    }
  });

  // --- задачи ---
  const tasks = [];
  for (const ev of events) {
    if (ev.type === "ticket-created") tasks.push({ id: ev.ticketId, createdAt: ev.ts, closedAt: null, firstSeq: ev.afterMessage + 1, lastSeq: null });
    if (ev.type === "ticket-closed") {
      const t = tasks.find(x => x.id === ev.ticketId && !x.closedAt) || (tasks.push({ id: ev.ticketId, createdAt: null, closedAt: null, firstSeq: 1, lastSeq: null }), tasks[tasks.length - 1]);
      t.closedAt = ev.ts; t.lastSeq = ev.afterMessage;
    }
  }
  tasks.forEach(t => { if (t.lastSeq === null) t.lastSeq = messages.length; });

  // --- заказы: надёжность по источнику ---
  const rank = { "client-button": 0, "log-selected": 0, "client-text": 1, "staff-text": 2, "system-text": 2, "bot-text": 3, "template-example": 4 };
  const by = {};
  for (const h of orderHits) {
    const o = by[h.orderNo] ||= { orderNo: h.orderNo, clientId: null, shipmentIds: [], sources: [], best: 9 };
    if (h.clientId && h.via !== "template-example") o.clientId ||= h.clientId;
    if (h.shipmentId && !o.shipmentIds.includes(h.shipmentId)) o.shipmentIds.push(h.shipmentId);
    o.sources.push({ via: h.via, ts: h.ts, msgId: h.msgId });
    o.best = Math.min(o.best, rank[h.via] ?? 5);
  }
  const orders = Object.values(by).map(o => ({
    ...o,
    confidence: o.best === 0 ? "selected" : o.best <= 2 ? "mentioned" : "example-or-bot-only"
  })).sort((a, b) => a.best - b.best);

  const clientId = orders.find(o => o.clientId)?.clientId || null;
  const roles = {};
  messages.forEach(m => roles[m.role] = (roles[m.role] || 0) + 1);
  return {
    clientId, clientName: name, messages, events, tasks, orders, delimiters,
    stats: { messages: messages.length, roles, boilerplate: messages.filter(m => m.kind === "boilerplate").length,
             menuClicks: messages.filter(m => m.kind === "menu-click").length, attachments: messages.filter(m => m.files.length).length }
  };
}
