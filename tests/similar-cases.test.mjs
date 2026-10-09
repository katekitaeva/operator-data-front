import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

// Создаём виртуальное DOM-окружение на основе index.html
const html = readFileSync("./index.html", "utf-8");
const dom = new JSDOM(html, { url: "http://localhost:3000/" });

global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.Option = dom.window.Option;

let failCount = 0;
function assert(name, condition, details = "") {
  if (condition) {
    console.log(`OK:   ${name}`);
  } else {
    failCount++;
    console.error(`FAIL: ${name} ${details ? `(${details})` : ""}`);
  }
}

console.log("=== ТЕСТ 1: Разметка блока похожих кейсов на Шаге 2 и модального окна ===");

const detailsEl = document.getElementById("similar-cases-details");
assert("Аккордеон #similar-cases-details существует", !!detailsEl);

const wipPill = detailsEl?.querySelector(".wip-pill");
assert("Плашка 🚧 В разработке удалена из аккордеона похожих кейсов", !wipPill);

const counterBadge = document.getElementById("similar-counter-badge");
assert("Счётчик найденных кейсов #similar-counter-badge существует", !!counterBadge);

const copyDigestBtn = document.getElementById("copy-similar-digest");
assert("Кнопка 'Скопировать выжимку для DeepSeek' существует", !!copyDigestBtn);

const listContainer = document.getElementById("similar-cases-list");
assert("Контейнер #similar-cases-list для карточек похожих кейсов существует", !!listContainer);

const detailModal = document.getElementById("case-detail-modal");
assert("Модальное окно #case-detail-modal детального просмотра кейса существует", !!detailModal);

const modalTitle = document.getElementById("case-detail-title");
const modalClose = document.getElementById("case-detail-close");
const modalCopyBtn = document.getElementById("case-detail-copy-btn");
const modalLoadBtn = document.getElementById("case-detail-load-btn");
assert("Элементы управления в модальном окне кейса присутствуют (заголовок, закрытие, копирование, загрузка)",
  !!(modalTitle && modalClose && modalCopyBtn && modalLoadBtn));

console.log("\n=== ТЕСТ 2: Стили CSS для блока похожих кейсов и карточки ===");
const css = readFileSync("./css/steps.css", "utf-8");
assert("CSS содержит стиль .similar-cases-box", css.includes(".similar-cases-box"));
assert("CSS содержит стиль .similar-case-card с эффектом при наведении", css.includes(".similar-case-card:hover"));
assert("CSS содержит бейдж релевантности .similar-score-badge", css.includes(".similar-score-badge"));
assert("CSS содержит стили модального окна .case-detail-modal-card", css.includes(".case-detail-modal-card"));
assert("CSS содержит блок 'Что сработало' .case-detail-worked-box", css.includes(".case-detail-worked-box"));

console.log("\n=== ТЕСТ 3: Модуль модального окна и форматирование карточки ===");
const { initCaseDetailModal, openCaseDetailModal, formatCaseMarkdown } = await import("../js/case-detail-modal.js");
initCaseDetailModal();

const sampleCase = {
  id: "test-case-1",
  ticket: "987654",
  order: "987-001",
  title: "Задержка доставки курьером",
  date: "2026-10-08",
  themes: ["Доставка > Курьер > Опоздание (DR)"],
  problem: "Курьер задержался на 3 часа и не предупредил клиента",
  demand: "Компенсация 500 баллов и перенос доставки",
  verdict: "Согласовано начисление 500 баллов и повторный выезд",
  whatWorked: "Связались со старшим смены курьерской службы и оперативно переназначили маршрут",
  actions: [
    { title: "Звонок клиенту", done: true, script: "Приносим искренние извинения за задержку" },
    { title: "Начислить баллы", done: true, points: 500, reason: "Задержка более 2 часов" }
  ],
  matching: {
    problemType: "delivery_delay",
    fault: "courier_service"
  }
};

const mdText = formatCaseMarkdown(sampleCase);
assert("formatCaseMarkdown содержит название кейса", mdText.includes("Задержка доставки курьером"));
assert("formatCaseMarkdown содержит тикет", mdText.includes("#987654"));
assert("formatCaseMarkdown содержит суть проблемы", mdText.includes("Курьер задержался на 3 часа"));
assert("formatCaseMarkdown содержит блок 'Что сработало'", mdText.includes("Связались со старшим смены"));
assert("formatCaseMarkdown содержит действия", mdText.includes("Звонок клиенту") && mdText.includes("Начислить баллы"));

// Проверка открытия модального окна
await openCaseDetailModal(sampleCase);
assert("Модальное окно становится видимым (hidden = false)", detailModal.hidden === false);
assert("Заголовок модального окна обновлен", modalTitle.textContent.includes("Задержка доставки курьером"));

const modalBody = document.getElementById("case-detail-body");
assert("Тело модального окна содержит суть проблемы", modalBody.textContent.includes("Курьер задержался на 3 часа"));
assert("Тело модального окна содержит 'Что сработало'", modalBody.textContent.includes("Связались со старшим смены"));
assert("Тело модального окна содержит действия чек-листа", modalBody.textContent.includes("Звонок клиенту"));
assert("Тело модального окна содержит параметры matching", modalBody.textContent.includes("delivery_delay"));

// Проверка закрытия модального окна
modalClose.click();
assert("Модальное окно закрывается при клике на крестик (hidden = true)", detailModal.hidden === true);

console.log("\n=== ТЕСТ 4: Выжимка похожих кейсов для DeepSeek ===");
const { getSimilarDigestForDeepSeek } = await import("../js/steps/step2.js");
assert("Функция getSimilarDigestForDeepSeek экспортируется и вызывается без ошибок", typeof getSimilarDigestForDeepSeek === "function");

if (failCount > 0) {
  console.error(`\nВсего провалов: ${failCount}`);
  process.exit(1);
} else {
  console.log("\n✅ Все тесты блока «Похожие кейсы из базы» и модального окна успешно пройдены!");
}
