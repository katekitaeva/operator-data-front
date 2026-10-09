import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

// Создаём виртуальное DOM-окружение на основе index.html
const html = readFileSync("./index.html", "utf-8");
const dom = new JSDOM(html, { url: "http://localhost:3000" });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;

// Импортируем модули приложения
const { state } = await import("../js/state.js");
const {
  buildCaseCard,
  loadCaseIntoForm,
  sanitizeCaseCard,
  redactPii,
  parseMatchingTextToObject,
  formatMatchingObjectToText
} = await import("../js/cases.js");
const { getDefaultActions } = await import("../js/steps/step4.js");

let fails = 0;
function assert(name, condition, info = "") {
  if (!condition) {
    console.error("FAIL:", name, info);
    fails++;
  } else {
    console.log("OK:  ", name);
  }
}

console.log("=== ТЕСТЫ 1: Парсинг и форматирование объекта matching ===");
const sampleMatchingText = `
problemType: cancelled_by_seller
blockers: seller_price_issue
fault: seller
demand: fulfil_order
resolution: points_compensation_ip, seller_request
stage: waiting_profile_dept
essence: Продавец отменил заказ после десяти дней ожидания.
`;

const parsedMatching = parseMatchingTextToObject(sampleMatchingText);
assert("parseMatchingTextToObject возвращает объект", parsedMatching && typeof parsedMatching === "object");
assert("parsedMatching.problemType корректен", parsedMatching.problemType === "cancelled_by_seller");
assert("parsedMatching.fault корректен", parsedMatching.fault === "seller");
assert("parsedMatching.essence корректен", parsedMatching.essence === "Продавец отменил заказ после десяти дней ожидания.");

const formattedBack = formatMatchingObjectToText(parsedMatching);
assert("formatMatchingObjectToText содержит problemType", formattedBack.includes("problemType: cancelled_by_seller"));
assert("formatMatchingObjectToText содержит fault", formattedBack.includes("fault: seller"));

console.log("\n=== ТЕСТЫ 2: Обезличивание PII в действиях и matching ===");
const rawCardWithPii = {
  ticket: "753683844",
  order: "12345678-0001",
  problem: "Клиентка Анна Иванова +7 999 123 45 67 жалуется на отмену",
  demand: "Вернуть деньги на карту 1234 5678 9876 5432",
  actions: [
    {
      id: "act-call",
      type: "call",
      title: "Звонок клиенту",
      script: "Здравствуйте! Это оператор, звоню по поводу карты 1234 5678 9876 5432 и телефона 89991234567"
    },
    {
      id: "act-chat",
      type: "chat",
      title: "Чат",
      text: "Анна, мы отправили письмо на anna@mail.ru"
    }
  ],
  matching: {
    problemType: "cancelled_by_seller",
    essence: "Клиент Иванов Иван +7 999 000 11 22 требует товар"
  }
};

const sanitized = sanitizeCaseCard(rawCardWithPii);
assert("PII в problem удален (телефон)", sanitized.problem.includes("[телефон]"));
assert("PII в problem удален (ФИО)", sanitized.problem.includes("[ФИО]"));
assert("PII в demand удален (карта)", sanitized.demand.includes("[номер карты]"));
assert("PII в action.script удален (карта)", sanitized.actions[0].script.includes("[номер карты]"));
assert("PII в action.script удален (телефон)", sanitized.actions[0].script.includes("[телефон]"));
assert("PII в action.text удален (email)", sanitized.actions[1].text.includes("[email]"));
assert("PII в matching.essence удален (телефон)", sanitized.matching.essence.includes("[телефон]"));
assert("PII в matching.essence удален (ФИО)", sanitized.matching.essence.includes("[ФИО]"));

console.log("\n=== ТЕСТЫ 3: Загрузка кейса старого формата (миграция действий) ===");
// Пример старого кейса типа 2026-10-07_753683844.json
const oldFormatCard = {
  id: "753683844",
  date: "2026-10-07",
  caseDatetime: "2026-10-07T14:30",
  ticket: "753683844",
  order: "12345678-0001",
  clientId: "c_8877",
  problem: "Задержка доставки на 3 дня",
  demand: "Компенсировать задержку баллами",
  chrono: "10:00 открыт тикет",
  status: "в работе",
  themes: [
    { path: "Доставка > Задержка > По вине службы", status: "в тикете", note: "Служба задержала рейс" }
  ],
  clientContext: {
    accruals: 500,
    orders: 12,
    cancels: 1,
    returns: 0,
    orderSum: 3500,
    clientStatus: "regular",
    critical: { k1: false, k2: true },
    labels: { l1: true, l2: false, l3: false, l4: false }
  },
  verdict: "Вина службы доставки (Loyalty п. 3)",
  outcome: {
    check: "- [ ] Проверить статус\n- [ ] Начислить баллы",
    reply: "Здравствуйте! Мы приносим извинения за задержку заказа 12345678-0001.",
    comment: "1. ПРОБЛЕМА: Задержка\n2. ТРЕБУЕТ: Баллы\n3. СДЕЛАНО: Ответ\n4. ОБОСНОВАНИЕ: Памятка"
  },
  whatWorked: "Вежливое объяснение причин",
  qcComments: "Стандарты соблюдены",
  themesVersion: { date: "2026-10-01", hash: "abc123" }
};

const loadedOld = loadCaseIntoForm(oldFormatCard, "2026-10-07_753683844.json");
assert("loadCaseIntoForm для старого кейса вернул true", loadedOld === true);
assert("state.loadedCase установлен", state.loadedCase && state.loadedCase.id === "753683844");
assert("state.actions инициализирован (создан базовый набор)", Array.isArray(state.actions) && state.actions.length >= 5);

const chatAction = state.actions.find(a => a.type === "chat");
assert("текст outcome.reply перенесен в действие Чат", chatAction && chatAction.text.includes("Мы приносим извинения"));

const commentAction = state.actions.find(a => a.type === "comment");
assert("текст outcome.comment перенесен в действие Закрыть тикет", commentAction && commentAction.commentText.includes("1. ПРОБЛЕМА: Задержка"));

assert("matchingText для старого кейса очищен для нового ввода", state.matchingText === "" && document.getElementById("matching-text").value === "");

console.log("\n=== ТЕСТЫ 4: Доработка и сохранение в новом формате ===");
// Заполняем matching на шаге 4 и отмечаем пункт
document.getElementById("matching-text").value = `problemType: delivery_delay\nfault: delivery_service\ndemand: compensation\nresolution: points_compensation_ip\nstage: closed\nessence: Задержка доставки на три дня, клиенту начислены баллы.`;
state.matchingText = document.getElementById("matching-text").value;
state.actions[0].done = true; // отмечаем первое действие
document.getElementById("case-title").value = "Задержка доставки: компенсация баллами";

const newCard = buildCaseCard();
assert("card.ticket сохранен", newCard.ticket === "753683844");
assert("card.order сохранен", newCard.order === "12345678-0001");
assert("card.title сохранен", newCard.title === "Задержка доставки: компенсация баллами");
assert("card.matching является структурированным объектом", newCard.matching && typeof newCard.matching === "object");
assert("card.matching.problemType равен delivery_delay", newCard.matching.problemType === "delivery_delay");
assert("card.matching.fault равен delivery_service", newCard.matching.fault === "delivery_service");
assert("card.actions сохранен в новом формате", Array.isArray(newCard.actions) && newCard.actions.length >= 5);
assert("отметка первого действия done=true сохранена", newCard.actions[0].done === true);

console.log("\n=== ТЕСТЫ 5: Эмуляция скрипта process_cases.py ===");
// Эмулируем обработку в process_cases.py
function emulateProcessCases(inboxCard, filename) {
  if (!inboxCard.ticket && !inboxCard.order) {
    throw new Error("Missing ticket or order");
  }
  const caseId = inboxCard.id || inboxCard.ticket || inboxCard.order;
  const manifestEntry = {
    id: caseId,
    file: filename,
    title: inboxCard.title || "",
    date: inboxCard.date || "",
    ticket: inboxCard.ticket || "",
    order: inboxCard.order || "",
    clientId: inboxCard.clientId || null,
    themes: inboxCard.themes || [],
    problem: inboxCard.problem || "",
    demand: inboxCard.demand || "",
    verdict: inboxCard.verdict || "",
    whatWorked: inboxCard.whatWorked || "",
    qcComments: inboxCard.qcComments || "",
    themesVersion: inboxCard.themesVersion || null
  };
  return manifestEntry;
}

const manifestItem = emulateProcessCases(newCard, "2026-10-07_753683844.json");
assert("process_cases успешно сформировал манифест: id", manifestItem.id === "753683844");
assert("process_cases успешно сформировал манифест: title", manifestItem.title.includes("Задержка доставки"));
assert("process_cases успешно сформировал манифест: themes", manifestItem.themes.length === 1);
assert("process_cases успешно сформировал манифест: verdict", manifestItem.verdict.includes("Памятке"));

console.log("\n=== ТЕСТЫ 6: Загрузка кейса нового формата обратно в форму ===");
// Очищаем форму и загружаем сохранённую новую карточку
state.actions = null;
state.matchingText = "";
document.getElementById("matching-text").value = "";

const loadedNew = loadCaseIntoForm(newCard, "2026-10-07_753683844.json");
assert("loadCaseIntoForm для нового кейса вернул true", loadedNew === true);
assert("actions точно восстановлен", Array.isArray(state.actions) && state.actions[0].done === true);
assert("matchingText восстановлен в текстовом поле", document.getElementById("matching-text").value.includes("problemType: delivery_delay"));
assert("state.matchingText содержит fault", state.matchingText.includes("fault: delivery_service"));

if (fails > 0) {
  console.error(`\n❌ Провалено тестов: ${fails}`);
  process.exit(1);
} else {
  console.log("\n✅ Все тесты жизненного цикла кейса (старый/новый формат, process_cases, matching, actions) пройдены!");
}
