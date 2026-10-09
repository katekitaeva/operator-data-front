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

const { resetClaimForm } = await import("../js/main.js");
const { state } = await import("../js/state.js");
const { checkTicketInArchive, resetTicketArchiveCheck } = await import("../js/steps/step1.js");

let failCount = 0;
function assert(name, condition, details = "") {
  if (condition) {
    console.log(`OK:   ${name}`);
  } else {
    failCount++;
    console.error(`FAIL: ${name} ${details ? `(${details})` : ""}`);
  }
}

console.log("=== ТЕСТ 1: Кнопка «Начать новую претензию» ===");
// Заполняем форму тестовыми данными и переходим на шаг 4
document.getElementById("ticket").value = "123456";
document.getElementById("order").value = "12345-001";
document.getElementById("problem").value = "Тестовая проблема";
document.getElementById("demand").value = "Тестовое требование";
state.current = 4;
state.themes = [{ path: "Тема > Подтема", status: "в тикете" }];
state.loadedCase = { file: "test.json", ticket: "123456" };

// Закрываем аккордеоны
document.getElementById("helper").open = false;
document.getElementById("helper2").open = false;
document.getElementById("helper4").open = false;

// Вызываем resetClaimForm()
resetClaimForm();

assert("Форма переключена на шаг 1", state.current === 1, `текущий шаг: ${state.current}`);
assert("Поле ticket очищено", document.getElementById("ticket").value === "");
assert("Поле problem очищено", document.getElementById("problem").value === "");
assert("Поле demand очищено", document.getElementById("demand").value === "");
assert("state.loadedCase очищен", state.loadedCase === null);
assert("state.themes очищен", state.themes.length === 0);
assert("Аккордеон helper открыт", document.getElementById("helper").open === true);
assert("Аккордеон helper2 открыт", document.getElementById("helper2").open === true);
assert("Аккордеон helper4 открыт", document.getElementById("helper4").open === true);

console.log("\n=== ТЕСТ 2: Разметка и стили шага 1 (Суть проблемы, размер шрифта) ===");
const problemLabel = document.querySelector('label[for="problem"]');
assert("Лейбл переименован в «Суть проблемы»", problemLabel && problemLabel.textContent.trim() === "Суть проблемы", problemLabel?.textContent);

const cssContent = readFileSync("./css/steps.css", "utf-8");
assert("Стили CSS содержат увеличенный шрифт 15.5px для #problem", cssContent.includes("textarea#problem") && cssContent.includes("15.5px"));
assert("Стили CSS содержат увеличенный шрифт для #demand", cssContent.includes("textarea#demand") && cssContent.includes("15.5px"));
assert("Стили CSS содержат баннер предложения кейса", cssContent.includes(".ticket-found-banner"));

console.log("\n=== ТЕСТ 3: Обновленный промт step001.md ===");
const promptContent = readFileSync("./prompts/step001.md", "utf-8");
assert("Правило 8 требует только суть проблемы", promptContent.includes("ТОЛЬКО суть проблемы"));
assert("Правило 8 запрещает длинную поминутную хронологию", promptContent.includes("без длинной поминутной хронологии"));
assert("Выходной формат указывает 2-4 предложения", promptContent.includes("только суть проблемы в 2-4 предложениях"));

console.log("\n=== ТЕСТ 4: Баннеры проверки тикета в форме ===");
const banner = document.getElementById("ticket-found-banner");
const helperBanner = document.getElementById("helper-ticket-found-banner");
assert("Баннер в основной форме существует", banner !== null);
assert("Баннер в помощнике существует", helperBanner !== null);
assert("Кнопка 'Загрузить кейс' в баннере существует", document.getElementById("btn-load-found-ticket") !== null);
assert("Кнопка 'Отказаться' в баннере существует", document.getElementById("btn-dismiss-found-ticket") !== null);

if (failCount > 0) {
  console.error(`\n❌ Провалено тестов: ${failCount}`);
  process.exit(1);
} else {
  console.log("\n✅ Все тесты отчёта о багах успешно пройдены!");
}
