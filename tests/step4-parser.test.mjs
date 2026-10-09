import { parseStep4FinalResponse, validateMatchingText } from "../js/steps/step4.js";

const sampleResponse = `
ИТОГ ДЛЯ ФОРМЫ
РЕШЕНИЕ: 2. Индивидуальный подход без отправки товара
ДЕЙСТВИЕ: ЗВОНОК
ВРЕМЯ: [время звонка]
СКРИПТ: Здравствуйте, это [имя оператора]. Звоню по вашему обращению о заказе.
Объясню, что произошло, и предложу решение.
ДЕЙСТВИЕ: ЧАТ
ТЕКСТ: Здравствуйте! Мы разобрались с заказом и готовы предложить решение. Подробности расскажем по телефону.
ДЕЙСТВИЕ: БАЛЛЫ
ТИП: баллы
СУММА: [N баллов]
ПРИЧИНА: [причина начисления]
СОГЛАСОВАНИЕ: не требуется
ДЕЙСТВИЕ: ЗАДАЧА
КОМУ: [отдел]
ТЕКСТ: Уточнить у продавца причину отмены заказа.
НОМЕР: [номер]
ДЕЙСТВИЕ: ЗАДАЧА
КОМУ: CTASK
ТЕКСТ: Проверить результат через [срок по инструкции].
НОМЕР: [номер]
ДЕЙСТВИЕ: ЗАКРЫТИЕ
КОММЕНТАРИЙ:
1. ПРОБЛЕМА: Клиент ждал заказ 10 дней, продавец его отменил.
2. ТРЕБУЕТ: Отправить именно товар, а не возвращать деньги.
3. СДЕЛАНО: Звонок, начисление [N баллов], две задачи.
4. ОБОСНОВАНИЕ: Памятка Loyalty, критерии клиента.
МАТЧИНГ
problemType: cancelled_by_seller
blockers: seller_price_issue
fault: seller
demand: fulfil_order
resolution: points_compensation_ip, seller_request
stage: waiting_profile_dept
essence: Продавец отменил заказ после десяти дней ожидания, клиент требует отправить товар и грозит судом.
КОНЕЦ ИТОГА
`;

let fails = 0;
function assert(name, condition, info = "") {
  if (!condition) {
    console.error("FAIL:", name, info);
    fails++;
  } else {
    console.log("OK:  ", name);
  }
}

// 1. Тест эталонного блока
const parsed = parseStep4FinalResponse(sampleResponse);
assert("разбор успешен", !parsed.error, JSON.stringify(parsed));
assert("решение извлечено", parsed.resolutionTitle.includes("Индивидуальный подход"));
assert("распознано 6 действий (звонок, чат, баллы, задача 1, задача 2, закрытие)", parsed.actions.length === 6, parsed.actions.length);
assert("первое действие ЗВОНОК", parsed.actions[0].rawType === "ЗВОНОК");
assert("скрипт звонка многострочный", parsed.actions[0].fields.СКРИПТ.includes("Объясню, что произошло"));
assert("действие ЧАТ", parsed.actions[1].rawType === "ЧАТ");
assert("действие БАЛЛЫ", parsed.actions[2].rawType === "БАЛЛЫ" && parsed.actions[2].fields.ТИП === "баллы");
assert("две задачи распознаны", parsed.actions.filter(a => a.rawType === "ЗАДАЧА").length === 2);
assert("действие ЗАКРЫТИЕ содержит 4 части комментария", parsed.actions[5].rawType === "ЗАКРЫТИЕ" && Array.isArray(parsed.actions[5].fields.КОММЕНТАРИЙ));
assert("блок МАТЧИНГ содержит problemType", parsed.matching.includes("problemType: cancelled_by_seller"));

// 2. Тест с markdown звездочками
const mdResponse = `
ИТОГ ДЛЯ ФОРМЫ
**РЕШЕНИЕ**: **1. Вариант**
* ДЕЙСТВИЕ: ЧАТ
**ТЕКСТ**: Привет!
* ДЕЙСТВИЕ: ЗАКРЫТИЕ
**КОММЕНТАРИЙ**:
1. ПРОБЛЕМА: тест
МАТЧИНГ
problemType: item_mismatch
КОНЕЦ ИТОГА
`;
const parsedMd = parseStep4FinalResponse(mdResponse);
assert("markdown звездочки удалены", !parsedMd.error && parsedMd.actions.length === 2);

// 3. Тест отсутствия границ
const badResponse = "Просто какой-то текст без меток";
const parsedBad = parseStep4FinalResponse(badResponse);
assert("ошибка при отсутствии границ", parsedBad.error === "no_boundaries");

// 4. Тест валидации справочника
const mockDict = {
  fields: {
    problemType: { type: "one", values: { cancelled_by_seller: "Отменен продавцом" } },
    blockers: { type: "many", values: { seller_price_issue: "Проблема цены" } }
  }
};
const validWarns = validateMatchingText("problemType: cancelled_by_seller\nblockers: seller_price_issue", mockDict);
assert("валидные значения не дают предупреждений", validWarns.length === 0, JSON.stringify(validWarns));

const invalidWarns = validateMatchingText("problemType: item_mismach\nblockers: unknown_blocker", mockDict);
assert("неизвестные значения дают предупреждения", invalidWarns.length === 2, JSON.stringify(invalidWarns));

if (fails > 0) {
  process.exit(1);
} else {
  console.log("\nВсе тесты шага 4 успешно пройдены!");
}
