// Запуск: node tests/chat-parser.test.mjs <путь к HTML выгрузки чата>
// Фикстуру с настоящим чатом НЕ кладём в публичный репозиторий: только в приватный operator-data.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { parseChat } from "../js/chat/parse-chat.js";
import { redact } from "../js/chat/redact.js";
import { buildTranscript, verifyQuote } from "../js/chat/transcript.js";

let fail = 0;
const check = (name, ok, info = "") => { if (!ok) fail++; console.log((ok ? "OK   " : "FAIL ") + name + (info ? "  → " + info : "")); };

if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], "utf8");
  const p = parseChat(html, { DOMParser: new JSDOM("").window.DOMParser });

  check("реплики разобраны", p.messages.length === 62, p.messages.length);
  const R = p.stats.roles;
  check("роли: клиент/бот/система/сотрудник", R.client === 29 && R.bot === 31 && R.system === 1 && R.staff === 1, JSON.stringify(R));
  check("выбор заказа не свёрнут как клик меню", p.messages.some(m => m.kind === "order-select"));
  check("у каждой реплики есть id и время", p.messages.every(m => m.id && m.time && m.ts));
  check("найдена одна задача с окном", p.tasks.length === 1 && p.tasks[0].createdAt && p.tasks[0].closedAt, JSON.stringify(p.tasks));
  const inTask = p.messages.filter(m => m.taskId === p.tasks[0]?.id);
  check("реплики после закрытия задачи вне окна", p.messages.at(-1).taskId === null && inTask.length < p.messages.length, `в окне ${inTask.length} из ${p.messages.length}`);
  check("выбранный клиентом заказ найден", p.orders[0]?.confidence === "selected", p.orders[0]?.orderNo);
  check("пример номера из текста бота не считается заказом клиента", p.orders.filter(o => o.confidence === "example-or-bot-only").every(o => !o.sources.some(s => s.via.startsWith("client") || s.via === "log-selected")), p.orders.map(o => o.orderNo + ":" + o.confidence).join(", "));
  check("идентификатор клиента взят из ссылок", !!p.clientId, p.clientId);
  check("имя клиента определено по приветствию", !!p.clientName);
  check("сообщение сотрудника: id сотрудника из ссылки", p.messages.find(m => m.role === "staff")?.staffId != null);

  const r = redact(p), t = buildTranscript(r, { taskId: p.tasks[0].id });
  const names = [p.clientName, ...new Set(p.messages.filter(m => m.role === "staff").map(m => m.author))].filter(Boolean);
  check("имена не попали в расшифровку", names.every(n => !t.text.includes(n)), `проверено имён: ${names.length}`);
  check("шум свёрнут (меню и приветствия)", t.text.split("\n").length < inTask.length, `${t.text.split("\n").length} строк вместо ${inTask.length}`);

  const free = inTask.find(m => m.kind === "text" && m.role === "client" && m.text.length > 25);
  check("настоящая цитата находится", verifyQuote(p, free.text.slice(0, 25), { taskId: p.tasks[0].id }).length >= 1);
  check("выдуманная цитата не находится", verifyQuote(p, "клиент потребовал неустойку по закону", {}).length === 0);
} else {
  console.log("chat-parser: Проверка реальной выгрузки пропущена (путь не указан в аргументах)");
}

// --- синтетические крайние случаи ---
const DP = new JSDOM("").window.DOMParser;
const wrap = inner => `<div data-qa-id="chat-dialog.chat.messages-list">${inner}</div>`;
const msg = (cls, id, time, text, author = "") => `<div class="chat-message ${cls}"><div class="chat-message__content" data-qa-id="chat-dialog.chat.message.${id}">${author}<div class="chat-message-content-blocks"><span class="chat-message-content-blocks__text">${text}</span></div></div><div class="chat-message__additional"><div class="chat-message__meta"><span class="chat-message__date">${time}</span></div></div></div>`;
const closed = `<div class="chat-list__status-log__row"><span class="chat-list__status-log__item"><span>Задача</span><a href="/tickets/111">№111</a><span>закрыта</span></span><span class="chat-list__status-log__item-with-dot">02.10.2026 в 12:00</span></div>`;
const a = parseChat(wrap(`<div class="chat-messages__previous-text">02.10.2026</div>` + msg("chat-message_client", "1", "11:00", "Тест") + closed), { DOMParser: DP });
check("задача закрыта без записи о создании: окно с начала, createdAt пуст", a.tasks.length === 1 && a.tasks[0].createdAt === null && a.tasks[0].closedAt === "2026-10-02T12:00");
const b = parseChat(wrap(msg("chat-message_client", "2", "10:00", "Без даты")), { DOMParser: DP });
check("нет заголовка даты: ts пуст, но разбор не падает", b.messages.length === 1 && b.messages[0].ts === null);
const au = `<div class="chat-message__author"><a class="chat-message__author-link" href="/users/7">Иван</a></div>`;
const c = parseChat(wrap(msg("chat-message_interlocutor", "3", "10:00", "Раз", au) + msg("chat-message_interlocutor chat-message_same-type", "4", "10:01", "Два")), { DOMParser: DP });
check("продолжение серии наследует автора", c.messages[1].author === "Иван" && c.messages[1].role === "staff");
const d = parseChat("<p>не чат</p>", { DOMParser: DP });
check("не чат: пустой результат без ошибок", d.messages.length === 0 && d.tasks.length === 0);

if (typeof p !== "undefined" && typeof t !== "undefined") {
  console.log("\nстатистика:", JSON.stringify(p.stats));
  console.log("\n--- расшифровка окна задачи (обезличенная) ---\n" + t.text.slice(0, 2500));
}
console.log(fail ? `\nПРОВАЛОВ: ${fail}` : "\nвсе проверки пройдены");
